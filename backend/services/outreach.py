import json
import time
import random
from datetime import datetime, timedelta
import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from sqlalchemy.orm import Session
import requests
from database import Lead, Log, Setting, SessionLocal

# Realistic Call Transcripts & Outcomes
SIMULATED_CALLS = {
    "interested": {
        "transcript": """[Agent Sarah]: Hello! Am I speaking with {name}, the {title} at {company}?
[Prospect {name}]: Yes, this is {name}. Who is this?
[Agent Sarah]: Hi {name}! This is Sarah from Wority Technology. I was looking at {company}'s tech stack and saw you might be evaluating cloud migration and IT modernization solutions this quarter. I wanted to see if you have 2 minutes to talk?
[Prospect {name}]: Oh, yes. Actually, we are planning to migrate some of our legacy workloads to AWS, but we've been struggling to find local expertise.
[Agent Sarah]: That is exactly what we specialize in! We've helped several IT services and product companies in Gujarat reduce infrastructure costs by 30% through optimized AWS migrations. Would you be open to a quick 15-minute discovery call next Tuesday to see how we can help {company}?
[Prospect {name}]: Sure, that sounds reasonable. Can you send me an email with some details and a booking link?
[Agent Sarah]: Absolutely, I'll send a personalized email to {email} right away with our calendar link. Have a wonderful day!
[Prospect {name}]: Thanks, Sarah. Bye.""",
        "duration": 78,
        "recording_url": "https://api.vapi.ai/recordings/demo-interested-call-10823.wav"
    },
    "not_interested": {
        "transcript": """[Agent Sarah]: Hello! Am I speaking with {name}, the {title} at {company}?
[Prospect {name}]: Yes. What is this about?
[Agent Sarah]: Hi {name}! This is Sarah from Wority Technology. I wanted to check if {company} is looking to optimize its IT infrastructure and cloud server operations this year?
[Prospect {name}]: No, we have a fully in-house team handling all AWS/DevOps work. We are not looking for external partners right now.
[Agent Sarah]: Got it! I appreciate your honesty. If anything changes or if you need backup capacity in the future, is it okay if we drop a brief email for your records?
[Prospect {name}]: Sure, you can email, but we won't be purchasing. Thanks.
[Agent Sarah]: Understood. Have a great day!""",
        "duration": 42,
        "recording_url": "https://api.vapi.ai/recordings/demo-not-interested-call-9231.wav"
    },
    "voicemail": {
        "transcript": """[Voicemail System]: Your call has been forwarded to the voicemail of: {name}... Please leave a message after the tone. *Beep*
[Agent Sarah]: Hi {name}, this is Sarah from Wority Technology. I was calling regarding cloud hosting optimization for {company}. I will follow up with an email containing details. You can reach us back at hello@woritytechnology.com. Thank you!""",
        "duration": 25,
        "recording_url": "https://api.vapi.ai/recordings/demo-voicemail-call-4512.wav"
    }
}

# 1. AI Voice Call (Vapi.ai) Integration
def trigger_vapi_call(db: Session, lead_id: int):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        return {"status": "error", "message": "Lead not found"}
        
    settings = {s.key: s.value for s in db.query(Setting).all()}
    is_simulation = settings.get("simulation_mode", "true").lower() == "true"
    
    lead.call_status = "calling"
    db.commit()
    
    log_action(db, lead_id, "Called", f"Initiated outbound voice call to {lead.phone} via Vapi.ai.")
    
    if is_simulation:
        # Start a background thread to simulate call completion in 8 seconds
        thread = threading.Thread(target=simulate_vapi_call_lifecycle, args=(lead_id,))
        thread.start()
        return {"status": "success", "mode": "simulation", "message": "Simulated call initiated in background"}
    else:
        # Real API request to Vapi.ai
        vapi_key = settings.get("vapi_api_key")
        assistant_id = settings.get("vapi_assistant_id")
        
        if not vapi_key or not assistant_id:
            lead.call_status = "failed"
            db.commit();
            log_action(db, lead_id, "Status Update", "Vapi Call failed: API Key or Assistant ID missing.")
            return {"status": "error", "message": "Vapi.ai credentials not configured"}
            
        url = "https://api.vapi.ai/call/phone"
        headers = {
            "Authorization": f"Bearer {vapi_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "assistantId": assistant_id,
            "customer": {
                "number": lead.phone,
                "name": lead.name
            },
            "phoneNumberId": settings.get("twilio_sid") # Optional or specific Vapi Twilio number
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers)
            if response.status_code in [200, 201]:
                res_data = response.json()
                log_action(db, lead_id, "Status Update", f"Vapi Call dispatched. Call ID: {res_data.get('id')}")
                return {"status": "success", "mode": "production", "call_id": res_data.get("id")}
            else:
                lead.call_status = "failed"
                db.commit()
                log_action(db, lead_id, "Status Update", f"Vapi Call failed. HTTP {response.status_code}: {response.text}")
                return {"status": "error", "message": response.text}
        except Exception as e:
            lead.call_status = "failed"
            db.commit()
            log_action(db, lead_id, "Status Update", f"Vapi Call Exception: {str(e)}")
            return {"status": "error", "message": str(e)}

# 2. SMTP Email Follow-up Integration
def send_smtp_email(db: Session, lead_id: int):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        return False
        
    settings = {s.key: s.value for s in db.query(Setting).all()}
    is_simulation = settings.get("simulation_mode", "true").lower() == "true"
    
    # Select template based on call outcome
    outcome = lead.call_outcome
    try:
        subject, body = get_email_template(lead, outcome)
    except Exception as ex:
        print("EXCEPTION IN get_email_template:", ex)
        return False
        
    if is_simulation:
        lead.email_status = "sent"
        db.commit()
        log_action(db, lead_id, "Emailed", f"[EMAIL SIMULATION] Sent email to {lead.email}. Subject: '{subject}'")
        return True
        
    smtp_host = settings.get("smtp_host")
    smtp_port = int(settings.get("smtp_port", "587"))
    smtp_user = settings.get("smtp_user")
    smtp_password = settings.get("smtp_password")
    smtp_sender = settings.get("smtp_sender")
    
    if not smtp_user or not smtp_password:
        lead.email_status = "failed"
        db.commit()
        log_action(db, lead_id, "Status Update", "Email follow-up failed: SMTP credentials missing in Settings.")
        return False
        
    try:
        msg = MIMEMultipart()
        msg['From'] = smtp_sender
        msg['To'] = lead.email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'html'))
        
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.sendmail(smtp_sender, lead.email, msg.as_string())
        server.close()
        return True
    except Exception as e:
        print("EXCEPTION IN SMTP SEND:", e)
        lead.email_status = "failed"
        db.commit()
        log_action(db, lead_id, "Status Update", f"Email follow-up exception: {str(e)}")
        return False


# 3. Meta WhatsApp Automation Integration
def send_whatsapp_message(db: Session, lead_id: int):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        return False
        
    settings = {s.key: s.value for s in db.query(Setting).all()}
    is_simulation = settings.get("simulation_mode", "true").lower() == "true"
    
    # Template contents
    outcome = lead.call_outcome
    text_content = get_whatsapp_text(lead, outcome)
    
    if is_simulation:
        lead.whatsapp_status = "sent"
        db.commit()
        log_action(db, lead_id, "WhatsApped", f"[WHATSAPP SIMULATION] Sent WhatsApp message to {lead.phone}: '{text_content}'")
        return True
        
    token = settings.get("whatsapp_token")
    phone_id = settings.get("whatsapp_phone_number_id")
    template_name = settings.get("whatsapp_template_name", "outreach_followup")
    
    if not token or not phone_id:
        lead.whatsapp_status = "failed"
        db.commit()
        log_action(db, lead_id, "Status Update", "WhatsApp outreach failed: Meta Access Token or Phone ID missing.")
        return False
        
    url = f"https://graph.facebook.com/v18.0/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Meta Cloud API Template Payload
    payload = {
        "messaging_product": "whatsapp",
        "to": lead.phone.replace(" ", "").replace("-", ""),
        "type": "template",
        "template": {
            "name": template_name,
            "language": {
                "code": "en"
            },
            "components": [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": lead.name},
                        {"type": "text", "text": lead.company}
                    ]
                }
            ]
        }
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        if response.status_code in [200, 201]:
            lead.whatsapp_status = "sent"
            db.commit()
            log_action(db, lead_id, "WhatsApped", f"WhatsApp template '{template_name}' sent to {lead.phone}.")
            return True
        else:
            lead.whatsapp_status = "failed"
            db.commit()
            log_action(db, lead_id, "Status Update", f"WhatsApp failed. HTTP {response.status_code}: {response.text}")
            return False
    except Exception as e:
        lead.whatsapp_status = "failed"
        db.commit()
        log_action(db, lead_id, "Status Update", f"WhatsApp Exception: {str(e)}")
        return False

# Helpers
def log_action(db: Session, lead_id: int, action: str, details: str):
    log = Log(lead_id=lead_id, action=action, details=details)
    db.add(log)
    db.commit()

def get_email_template(lead, outcome):
    # LinkedIn connection sequence followups
    if lead.linkedin_status == "accepted":
        if lead.email_sequence_step == 0:
            subject = f"Nice connecting on LinkedIn - Cloud Optimization for {lead.company}"
            body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <p>Hi {lead.name},</p>
                    <p>Thanks for connecting on LinkedIn! I noticed you are leading the IT / Engineering team at <strong>{lead.company}</strong>.</p>
                    <p>I wanted to drop a quick note to share how we help companies in the IT services sector reduce cloud server expenses by up to 30% through optimized migrations and architecture audits.</p>
                    <p>Are you open to a brief chat next week? Let me know if a specific day works.</p>
                    <br>
                    <p>Best regards,</p>
                    <p><strong>Sarah & The Wority Technology Team</strong></p>
                </body>
            </html>
            """
            return subject, body
        elif lead.email_sequence_step == 1:
            subject = f"Follow-up: AWS & Cloud Optimization checklist for {lead.company}"
            body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <p>Hi {lead.name},</p>
                    <p>I wanted to follow up on my note from a couple of days ago. I know your calendar is packed, but if cloud infrastructure scaling or cost optimization is on your radar this quarter, I'd love to share our technical checklists.</p>
                    <p>If you're interested, you can directly book a 15-minute slot on our team calendar here: <a href="https://calendly.com/wority-tech/discovery" style="color: #2563eb;">Schedule 15-Min Quick Sync</a>.</p>
                    <p>Thanks and have a great week!</p>
                    <br>
                    <p>Best regards,</p>
                    <p><strong>Sarah & The Wority Technology Team</strong></p>
                </body>
            </html>
            """
            return subject, body

    if outcome == "interested":
        subject = f"Discovery Call Booking Details - {lead.company}"
        body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <p>Hi {lead.name},</p>
                <p>It was fantastic speaking with you on the phone earlier today about <strong>{lead.company}</strong>'s cloud migration and DevOps scaling initiatives.</p>
                <p>As discussed, here is the link to schedule our brief 15-minute discovery call with our senior engineering team: <a href="https://calendly.com/wority-tech/discovery" style="color: #2563eb; font-weight: bold;">Book 15-Min Discovery Session</a>.</p>
                <p>Looking forward to speaking with you next week!</p>
                <br>
                <p>Best regards,</p>
                <p><strong>Sarah & The Wority Technology Team</strong><br>hello@woritytechnology.com</p>
            </body>
        </html>
        """
    elif outcome == "voicemail":
        subject = f"Tried reaching you: Cloud migration services for {lead.company}"
        body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <p>Hi {lead.name},</p>
                <p>I tried calling you a few minutes ago but was directed to your voicemail. I wanted to reach out regarding our IT modernization and cloud services optimized specifically for technology and IT companies.</p>
                <p>You can find more about what we do at <a href="https://www.woritytechnology.com">our website</a>, or if you'd like, you can directly book a slot to sync up here: <a href="https://calendly.com/wority-tech/discovery" style="color: #2563eb;">Schedule Call</a>.</p>
                <p>Have a great rest of your day!</p>
                <br>
                <p>Best regards,</p>
                <p><strong>Sarah & The Wority Technology Team</strong></p>
            </body>
        </html>
        """
    else:
        subject = f"IT Infrastructure Optimization - {lead.company}"
        body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <p>Hi {lead.name},</p>
                <p>Thank you for taking my call today. I understand that you have internal teams handling IT infrastructure for <strong>{lead.company}</strong> right now.</p>
                <p>I am leaving our company profile and AWS migration case studies for your records. If you ever require external backup resources, security audits, or optimization consulting, we would love to assist.</p>
                <p>Wishing you and your team continued success.</p>
                <br>
                <p>Best regards,</p>
                <p><strong>Sarah & The Wority Technology Team</strong></p>
            </body>
        </html>
        """
    return subject, body

def get_whatsapp_text(lead, outcome):
    if outcome == "interested":
        return f"Hi {lead.name}, thank you for your time on the call! I've sent you an email with the link to book our AWS/Cloud discovery session. Looking forward to it!"
    elif outcome == "voicemail":
        return f"Hi {lead.name}, I missed you on the phone. I've left a voicemail and sent an email regarding Wority Tech's cloud services. Let me know if we can connect!"
    else:
        return f"Hi {lead.name}, thanks for taking my call today. I've sent the requested materials to {lead.email}. Let us know if we can help in the future."

# Simulation Lifecycle Worker
def simulate_vapi_call_lifecycle(lead_id: int):
    # Separate DB Session for background thread
    db = SessionLocal()
    try:
        # Wait a bit to simulate a phone call conversation
        time.sleep(6)
        
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if not lead:
            return
            
        # Randomly choose outcome: 60% interested, 30% voicemail, 10% not interested
        outcome = random.choices(["interested", "voicemail", "not_interested"], weights=[60, 30, 10], k=1)[0]
        call_details = SIMULATED_CALLS[outcome]
        
        lead.call_status = "completed"
        lead.call_outcome = outcome
        lead.call_duration = call_details["duration"]
        lead.recording_url = call_details["recording_url"]
        lead.transcript = call_details["transcript"].format(
            name=lead.name, 
            title=lead.title or "IT Director", 
            company=lead.company, 
            email=lead.email
        )
        lead.status = "contacted"
        if outcome == "interested":
            lead.status = "converted" # booked appointment / highly interested lead
            
        db.commit()
        
        log_action(db, lead_id, "Status Update", f"Simulated call finished. Outcome: {outcome.upper()}. Status: {lead.status.upper()}. Duration: {lead.call_duration}s.")
        
        # Trigger follow-up automation flow (n8n simulator style)
        time.sleep(2)
        send_smtp_email(db, lead_id)
        
        time.sleep(2)
        send_whatsapp_message(db, lead_id)
        
    except Exception as e:
        print(f"Error in simulated call lifecycle: {e}")
    finally:
        db.close()

# 4. LinkedIn connection workflow & Daily limit queue throttler
def process_daily_linkedin_queue(db: Session):
    # Get settings
    settings = {s.key: s.value for s in db.query(Setting).all()}
    limit = int(settings.get("linkedin_daily_limit", "5"))
    
    # Find how many LinkedIn connection requests have already been marked as sent today
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sent_today = db.query(Lead).filter(
        Lead.linkedin_status.in_(["request_sent", "accepted"]),
        Lead.linkedin_sent_date >= today_start
    ).count()
    
    available_slots = max(0, limit - sent_today)
    print(f"LinkedIn Daily Limit: {limit}. Already sent today: {sent_today}. Slots available: {available_slots}")
    
    if available_slots == 0:
        return 0
        
    # Fetch leads in 'approved' status that don't have any LinkedIn status yet
    approved_leads = db.query(Lead).filter(
        Lead.status == "approved",
        Lead.linkedin_status == "none"
    ).limit(available_slots).all()
    
    queued_count = 0
    for lead in approved_leads:
        # Construct search url
        lead.linkedin_url = f"https://www.linkedin.com/search/results/people/?keywords={lead.name.replace(' ', '+')}+{lead.company.replace(' ', '+')}"
        lead.linkedin_status = "queued"
        
        log = Log(
            lead_id=lead.id,
            action="Status Update",
            details=f"Lead added to the daily LinkedIn Connection Queue. Connection Link generated."
        )
        db.add(log)
        queued_count += 1
        
    db.commit()
    print(f"Successfully queued {queued_count} leads for LinkedIn connection requests.")
    return queued_count

def mark_linkedin_sent(db: Session, lead_id: int):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        return False
        
    lead.linkedin_status = "request_sent"
    lead.linkedin_sent_date = datetime.utcnow()
    
    log = Log(
        lead_id=lead.id,
        action="Status Update",
        details="LinkedIn connection request marked as SENT by team."
    )
    db.add(log)
    db.commit()
    return True

def handle_linkedin_acceptance(db: Session, lead_id: int):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        return False
        
    lead.linkedin_status = "accepted"
    
    log = Log(
        lead_id=lead.id,
        action="Status Update",
        details="LinkedIn connection request ACCEPTED by prospect. Triggering Email Step 1."
    )
    db.add(log)
    db.commit()
    
    # Immediately trigger Email Step 1 (email_sequence_step is 0, will update to 1 inside outreach sequence)
    lead.email_sequence_step = 0
    db.commit()
    
    email_sent = send_smtp_email(db, lead.id)
    if email_sent:
        lead.email_sequence_step = 1
        lead.last_email_sent_date = datetime.utcnow()
        db.commit()
        
    return True

def check_sequencing_timeouts(db: Session):
    # Get delay configuration
    settings = {s.key: s.value for s in db.query(Setting).all()}
    delay_hours = int(settings.get("email_followup_delay_hours", "48"))
    
    cutoff_time = datetime.utcnow() - timedelta(hours=delay_hours)
    
    # Find leads waiting for 2nd email followup
    leads_for_followup = db.query(Lead).filter(
        Lead.linkedin_status == "accepted",
        Lead.email_sequence_step == 1,
        Lead.response_received == False,
        Lead.last_email_sent_date <= cutoff_time
    ).all()
    
    followup_count = 0
    for lead in leads_for_followup:
        log_action(db, lead.id, "Status Update", f"Timeout of {delay_hours}h reached with no reply to Email 1. Triggering Email Step 2.")
        
        # Trigger Email 2 template selection
        email_sent = send_smtp_email(db, lead.id)
        if email_sent:
            lead.email_sequence_step = 2
            lead.last_email_sent_date = datetime.utcnow()
            db.commit()
            followup_count += 1
    return followup_count

def check_linkedin_connections_automation(db: Session):
    # Get configuration settings
    settings = {s.key: s.value for s in db.query(Setting).all()}
    proxycurl_key = settings.get("proxycurl_api_key", "").strip()
    
    if not proxycurl_key:
        return 0
        
    leads = db.query(Lead).filter(Lead.linkedin_status == "request_sent").all()
    promoted_count = 0
    
    for lead in leads:
        is_accepted = False
        if proxycurl_key == "sandbox":
            import random
            is_accepted = random.random() < 0.5
        else:
            try:
                import urllib.request
                import json
                
                # Nubela Proxycurl API profile fetch
                url = f"https://nubela.co/proxycurl/api/v2/linkedin?url={lead.linkedin_url}"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {proxycurl_key}"})
                with urllib.request.urlopen(req, timeout=10) as response:
                    data = json.loads(response.read().decode())
                    degree = data.get("connection_degree", "2nd")
                    if degree in ["1st", 1]:
                        is_accepted = True
            except Exception as e:
                log_action(db, lead.id, "Error", f"Proxycurl automated connection check failed: {str(e)}")
                
        if is_accepted:
            handle_linkedin_acceptance(db, lead.id)
            promoted_count += 1
            
    return promoted_count

