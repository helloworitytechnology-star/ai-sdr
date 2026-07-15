import os
import threading
from typing import List, Dict, Optional
from pydantic import BaseModel
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func
import datetime

from database import init_db, SessionLocal, Lead, Log, Setting
import scraper
from services import google_sheets, outreach

# Initialize FastAPI App
app = FastAPI(title="AI SDR Agent API", version="1.0.0")

# Enable CORS for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup DB Initialization
@app.on_event("startup")
def startup_event():
    init_db()

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic Schemas
class LeadCreate(BaseModel):
    name: str
    email: str
    phone: str
    company: str
    title: Optional[str] = None
    source: Optional[str] = "Manual Entry"

class LeadUpdate(BaseModel):
    status: Optional[str] = None
    call_status: Optional[str] = None
    call_outcome: Optional[str] = None
    transcript: Optional[str] = None
    recording_url: Optional[str] = None
    email_status: Optional[str] = None
    whatsapp_status: Optional[str] = None

class BatchAction(BaseModel):
    lead_ids: List[int]
    action: str  # approve, reject, call

class VapiWebhookPayload(BaseModel):
    # Matches Vapi.ai webhook structure for call completion
    message: Dict

# Endpoints

@app.get("/api/leads")
def get_leads(
    status: Optional[str] = None,
    search: Optional[str] = None,
    source: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Lead)
    if status and status != "all":
        query = query.filter(Lead.status == status)
    if source and source != "all":
        query = query.filter(Lead.source == source)
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            (Lead.name.like(search_filter)) |
            (Lead.email.like(search_filter)) |
            (Lead.company.like(search_filter)) |
            (Lead.title.like(search_filter))
        )
    # Order by newest first
    return query.order_by(Lead.scraped_date.desc()).all()

@app.post("/api/leads")
def create_lead(lead_in: LeadCreate, db: Session = Depends(get_db)):
    # Check duplicate email
    existing = db.query(Lead).filter(Lead.email == lead_in.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Lead with this email already exists")
        
    lead = Lead(**lead_in.dict())
    db.add(lead)
    db.flush()
    
    log = Log(
        lead_id=lead.id,
        action="Scraped",
        details="Manually added prospect lead to database."
    )
    db.add(log)
    db.commit()
    db.refresh(lead)
    return lead

@app.put("/api/leads/{lead_id}")
def update_lead(lead_id: int, lead_in: LeadUpdate, db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    update_data = lead_in.dict(exclude_unset=True)
    old_status = lead.status
    
    for key, value in update_data.items():
        setattr(lead, key, value)
        
    if "status" in update_data and old_status != update_data["status"]:
        log = Log(
            lead_id=lead.id,
            action="Status Update",
            details=f"Status manually updated from '{old_status}' to '{update_data['status']}'."
        )
        db.add(log)
        
    db.commit()
    db.refresh(lead)
    return lead

@app.delete("/api/leads/{lead_id}")
def delete_lead(lead_id: int, db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.delete(lead)
    db.commit()
    return {"status": "success", "message": f"Lead {lead_id} deleted."}

# Scrape trigger
@app.post("/api/leads/scrape")
def trigger_scrape(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    # Execute in background task so API responds instantly
    background_tasks.add_task(scraper.run_scraper, db)
    return {"status": "success", "message": "Scraper run started in the background."}

# Google Sheets Sync trigger
@app.post("/api/leads/sync")
def trigger_google_sheets_sync(db: Session = Depends(get_db)):
    # 1. Sync local leads to sheet
    sync_success = google_sheets.sync_leads_to_sheet(db)
    # 2. Pull approval status modifications from sheet
    updated_count = google_sheets.pull_approvals_from_sheet(db)
    
    # 3. Pulling might have modified things, so re-sync updated values back
    if updated_count > 0:
        google_sheets.sync_leads_to_sheet(db)
        
    return {
        "status": "success" if sync_success else "error",
        "message": f"Sync completed. Pulled {updated_count} manual review modifications from Google Sheets."
    }

# Batch action: approve, reject, or call
@app.post("/api/leads/action")
def run_batch_action(payload: BatchAction, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    leads = db.query(Lead).filter(Lead.id.in_(payload.lead_ids)).all()
    if not leads:
        raise HTTPException(status_code=404, detail="No matching leads found")
        
    updated_count = 0
    if payload.action == "approve":
        for lead in leads:
            if lead.status == "scraped":
                lead.status = "approved"
                log = Log(lead_id=lead.id, action="Approved", details="Lead approved for outreach.")
                db.add(log)
                updated_count += 1
        db.commit()
        return {"status": "success", "message": f"Approved {updated_count} leads for outreach."}
        
    elif payload.action == "reject":
        for lead in leads:
            if lead.status == "scraped":
                lead.status = "rejected"
                log = Log(lead_id=lead.id, action="Rejected", details="Lead rejected and archived.")
                db.add(log)
                updated_count += 1
        db.commit()
        return {"status": "success", "message": f"Rejected {updated_count} leads."}
        
    elif payload.action == "call":
        called_count = 0
        for lead in leads:
            if lead.status == "approved" or lead.call_status in ["none", "failed"]:
                # Trigger outreach (Vapi Call)
                outreach.trigger_vapi_call(db, lead.id)
                called_count += 1
        return {"status": "success", "message": f"Dispatched calls to {called_count} prospects."}
        
    else:
        raise HTTPException(status_code=400, detail="Invalid action type")

# Vapi call status webhook receiver
@app.post("/api/outreach/vapi-webhook")
def vapi_webhook(payload: VapiWebhookPayload, db: Session = Depends(get_db)):
    message = payload.message
    call_msg_type = message.get("type")
    
    # We are interested in end-of-call webhooks
    if call_msg_type == "end-of-call-report":
        call_data = message.get("call", {})
        customer_phone = call_data.get("customer", {}).get("number")
        
        # Locate lead by phone
        lead = db.query(Lead).filter(Lead.phone == customer_phone).first()
        if lead:
            # Parse transcripts, outcomes and analysis
            transcript = message.get("transcript", "")
            duration = message.get("duration", 0)
            recording_url = message.get("recordingUrl", "")
            
            # Vapi gives assistant summary/analysis
            analysis = message.get("analysis", {})
            structured_data = analysis.get("structuredData", {})
            
            # Decide call outcome based on Vapi structured result or keyword matching
            outcome = "voicemail"
            if analysis.get("success") == True or structured_data.get("bookedAppointment") == True:
                outcome = "interested"
            elif "not interested" in transcript.lower() or "remove" in transcript.lower():
                outcome = "not_interested"
            elif duration > 30:
                # Fallback heuristic
                outcome = "interested"
                
            lead.call_status = "completed"
            lead.call_outcome = outcome
            lead.call_duration = duration
            lead.recording_url = recording_url
            lead.transcript = transcript
            lead.status = "contacted"
            
            if outcome == "interested":
                lead.status = "converted"
                
            # Log
            log = Log(
                lead_id=lead.id,
                action="Status Update",
                details=f"Call completed. Status: {lead.status.upper()}. Outcome: {outcome.upper()}"
            )
            db.add(log)
            db.commit()
            
            # Trigger follow-up email
            outreach.send_smtp_email(db, lead.id)
            # Trigger WhatsApp followup
            outreach.send_whatsapp_message(db, lead.id)
            
            # Sync to Google Sheets if configured
            google_sheets.sync_leads_to_sheet(db)
            
            return {"status": "success", "message": "Call report processed and outreach sequence executed"}
            
    return {"status": "ignored", "message": "Webhook message type ignored"}

# LinkedIn Connection Workflow APIs
@app.post("/api/leads/linkedin/queue")
def trigger_linkedin_queue(db: Session = Depends(get_db)):
    queued_count = outreach.process_daily_linkedin_queue(db)
    return {
        "status": "success",
        "message": f"Successfully processed daily throttler. Queued {queued_count} leads for LinkedIn Connection requests."
    }

@app.post("/api/leads/{lead_id}/linkedin-action")
def run_linkedin_action(lead_id: int, action: str = Query(..., description="sent, accept"), db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    if action == "sent":
        outreach.mark_linkedin_sent(db, lead_id)
        return {"status": "success", "message": "Connection request marked as SENT."}
    elif action == "accept":
        outreach.handle_linkedin_acceptance(db, lead_id)
        return {"status": "success", "message": "Connection request marked as ACCEPTED. Email Step 1 dispatched."}
    else:
        raise HTTPException(status_code=400, detail="Invalid action parameter. Use 'sent' or 'accept'")

@app.post("/api/leads/{lead_id}/simulate-reply")
def simulate_lead_reply(lead_id: int, db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    lead.response_received = True
    log = Log(
        lead_id=lead.id,
        action="Status Update",
        details="Prospect replied to outreach email. Outbound email follow-up sequence HALTED."
    )
    db.add(log)
    db.commit()
    return {"status": "success", "message": "Lead reply recorded. Sequencing halted."}

@app.post("/api/outreach/cron-check")
def trigger_cron_check(db: Session = Depends(get_db)):
    queued_count = outreach.process_daily_linkedin_queue(db)
    auto_accepted_count = outreach.check_linkedin_connections_automation(db)
    followup_count = outreach.check_sequencing_timeouts(db)
    return {
        "status": "success",
        "message": f"Automation check executed. Daily queue size: {queued_count}. Auto-accepted connections: {auto_accepted_count}. Timeout emails sent: {followup_count}."
    }


# Settings API
@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(Setting).all()
    return {s.key: s.value for s in settings}

@app.post("/api/settings")
def update_settings(payload: Dict[str, str], db: Session = Depends(get_db)):
    for k, v in payload.items():
        setting = db.query(Setting).filter(Setting.key == k).first()
        if setting:
            setting.value = v
        else:
            db.add(Setting(key=k, value=v))
    db.commit()
    return {"status": "success", "message": "Settings updated."}

# Audit Logs
@app.get("/api/logs")
def get_logs(db: Session = Depends(get_db)):
    logs = db.query(Log).order_by(Log.timestamp.desc()).limit(100).all()
    # Format list
    result = []
    for l in logs:
        lead = db.query(Lead).filter(Lead.id == l.lead_id).first()
        result.append({
            "id": l.id,
            "lead_name": lead.name if lead else "Unknown",
            "lead_company": lead.company if lead else "",
            "action": l.action,
            "details": l.details,
            "timestamp": l.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        })
    return result

# Analytics
@app.get("/api/analytics")
def get_analytics(db: Session = Depends(get_db)):
    # Funnel Stats: Total Scraped, Approved, Called, Converted
    total_scraped = db.query(Lead).count()
    approved = db.query(Lead).filter(Lead.status.in_(["approved", "contacted", "converted"])).count()
    called = db.query(Lead).filter(Lead.call_status == "completed").count()
    converted = db.query(Lead).filter(Lead.status == "converted").count()
    
    # Outcomes distribution
    outcomes = db.query(Lead.call_outcome, func.count(Lead.id)).group_by(Lead.call_outcome).all()
    outcomes_dict = {o[0]: o[1] for o in outcomes if o[0] != "none"}
    
    # Sources distribution
    sources = db.query(Lead.source, func.count(Lead.id)).group_by(Lead.source).all()
    sources_list = [{"name": s[0], "value": s[1]} for s in sources]
    
    # Daily trend of scraped leads (last 7 days)
    # Since sqlite DateTime is stored as Python object, we format and query
    trend_data = db.query(
        func.date(Lead.scraped_date), func.count(Lead.id)
    ).group_by(func.date(Lead.scraped_date)).order_by(func.date(Lead.scraped_date)).limit(7).all()
    
    trend_list = [{"date": t[0], "count": t[1]} for t in trend_data]
    
    return {
        "funnel": {
            "scraped": total_scraped,
            "approved": approved,
            "called": called,
            "converted": converted
        },
        "outcomes": outcomes_dict,
        "sources": sources_list,
        "trends": trend_list
    }

# Mount static files at root (last entry so API takes precedence)
static_path = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_path):
    app.mount("/", StaticFiles(directory=static_path, html=True), name="static")
