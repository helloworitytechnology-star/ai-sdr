import json
import random
from sqlalchemy.orm import Session
from database import Lead, Log, Setting

def get_sheets_client(credentials_json):
    # In a real environment, this imports google-auth and google-api-python-client
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        
        info = json.loads(credentials_json)
        creds = service_account.Credentials.from_service_account_info(info)
        service = build('sheets', 'v4', credentials=creds)
        return service
    except Exception as e:
        print(f"Failed to initialize Google Sheets client: {e}")
        return None

def sync_leads_to_sheet(db: Session):
    settings = {s.key: s.value for s in db.query(Setting).all()}
    sheet_id = settings.get("google_sheet_id")
    creds_json = settings.get("google_sheet_credentials")
    is_simulation = settings.get("simulation_mode", "true").lower() == "true"
    
    # Query all leads that haven't been synced or need sync
    leads = db.query(Lead).all()
    
    if is_simulation or not sheet_id or not creds_json:
        print(f"[GOOGLE SHEETS SIMULATION] Syncing {len(leads)} leads to sheet '{sheet_id or 'Demo SDR Sheet'}'")
        # In simulation mode, we just log this action
        return True

    client = get_sheets_client(creds_json)
    if not client:
        print("Google Sheets client not initialized. Skipping real sheet sync.")
        return False
        
    try:
        # Construct sheet values: Name, Email, Phone, Company, Title, Source, Status, Call Status, Outcome, Duration, Email Status, WA Status
        values = [["ID", "Name", "Email", "Phone", "Company", "Title", "Source", "Status", "Call Status", "Call Outcome", "Duration (s)", "Email Status", "WhatsApp Status"]]
        for lead in leads:
            values.append([
                str(lead.id),
                lead.name,
                lead.email,
                lead.phone,
                lead.company,
                lead.title or "",
                lead.source,
                lead.status,
                lead.call_status,
                lead.call_outcome,
                str(lead.call_duration),
                lead.email_status,
                lead.whatsapp_status
            ])
            
        body = {'values': values}
        
        # Write to sheet (overwrite the entire sheet for simplicity in Phase 1)
        client.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range="Sheet1!A1",
            valueInputOption="RAW",
            body=body
        ).execute()
        
        print(f"Successfully synced {len(leads)} leads to Google Sheet {sheet_id}")
        return True
    except Exception as e:
        print(f"Error syncing to Google Sheet: {e}")
        return False

def pull_approvals_from_sheet(db: Session):
    settings = {s.key: s.value for s in db.query(Setting).all()}
    sheet_id = settings.get("google_sheet_id")
    creds_json = settings.get("google_sheet_credentials")
    is_simulation = settings.get("simulation_mode", "true").lower() == "true"
    
    if is_simulation or not sheet_id or not creds_json:
        print("[GOOGLE SHEETS SIMULATION] Checking Google Sheets for manual approvals...")
        # Simulate human review: Randomly approve or reject 1-3 scraped leads
        scraped_leads = db.query(Lead).filter(Lead.status == "scraped").all()
        updated_count = 0
        if scraped_leads:
            leads_to_process = random.sample(scraped_leads, min(len(scraped_leads), random.randint(1, 3)))
            for lead in leads_to_process:
                new_status = random.choice(["approved", "rejected"])
                lead.status = new_status
                
                log = Log(
                    lead_id=lead.id,
                    action="Status Update",
                    details=f"Status updated to '{new_status}' via simulated Google Sheets approval sync."
                )
                db.add(log)
                updated_count += 1
            db.commit()
            print(f"[GOOGLE SHEETS SIMULATION] Processed {updated_count} manual review decisions from Google Sheets.")
        return updated_count

    client = get_sheets_client(creds_json)
    if not client:
        print("Google Sheets client not initialized. Skipping real sheet approval pull.")
        return 0

    try:
        # Read columns from sheet: ID (Col A), Status (Col H)
        result = client.spreadsheets().values().get(
            spreadsheetId=sheet_id,
            range="Sheet1!A2:H1000"
        ).execute()
        
        rows = result.get('values', [])
        if not rows:
            return 0
            
        updated_count = 0
        for row in rows:
            if len(row) < 8:
                continue
            lead_id_str = row[0]
            sheet_status = row[7].lower()
            
            try:
                lead_id = int(lead_id_str)
            except ValueError:
                continue
                
            lead = db.query(Lead).filter(Lead.id == lead_id).first()
            if lead and lead.status != sheet_status and sheet_status in ["approved", "rejected", "scraped", "contacted", "converted"]:
                old_status = lead.status
                lead.status = sheet_status
                
                log = Log(
                    lead_id=lead.id,
                    action="Status Update",
                    details=f"Status updated from '{old_status}' to '{sheet_status}' via Google Sheets sync."
                )
                db.add(log)
                updated_count += 1
                
        db.commit()
        print(f"Pulled approvals from Google Sheet. Updated {updated_count} leads.")
        return updated_count
    except Exception as e:
        print(f"Error pulling approvals from Google Sheet: {e}")
        return 0
