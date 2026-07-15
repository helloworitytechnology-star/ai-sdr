import datetime
import os
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

# Read database URL from environment or fallback to sqlite
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sdr_database.db")

# Render/Heroku sometimes provides database URL starting with postgres:// instead of postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    email = Column(String, index=True)
    phone = Column(String, index=True)
    company = Column(String, index=True)
    title = Column(String, nullable=True)
    source = Column(String, default="Web Scraping")
    scraped_date = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String, default="scraped")  # scraped, approved, rejected, contacted, converted
    
    # AI Voice Call details
    call_status = Column(String, default="none")  # none, pending, calling, completed, failed
    call_outcome = Column(String, default="none")  # none, interested, not_interested, voicemail
    transcript = Column(Text, nullable=True)
    recording_url = Column(String, nullable=True)
    call_duration = Column(Integer, default=0) # in seconds
    
    # Follow-ups
    email_status = Column(String, default="none")  # none, sent, failed
    whatsapp_status = Column(String, default="none")  # none, sent, failed

    # LinkedIn Connection Workflow
    linkedin_url = Column(String, nullable=True)
    linkedin_status = Column(String, default="none")  # none, queued, request_sent, accepted
    linkedin_sent_date = Column(DateTime, nullable=True)
    
    # Advanced Email Follow-up Sequencing
    email_sequence_step = Column(Integer, default=0)  # 0: none, 1: Email 1 sent, 2: Email 2 sent
    last_email_sent_date = Column(DateTime, nullable=True)
    response_received = Column(Boolean, default=False)

    logs = relationship("Log", back_populates="lead", cascade="all, delete-orphan")

class Log(Base):
    __tablename__ = "logs"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"))
    action = Column(String)  # Scraped, Approved, Rejected, Called, Emailed, WhatsApped, Status Update
    details = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    lead = relationship("Lead", back_populates="logs")

class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True, index=True)
    value = Column(Text, nullable=True)

def init_db():
    Base.metadata.create_all(bind=engine)
    
    # Pre-populate default configurations if empty
    db = SessionLocal()
    try:
        default_settings = {
            "simulation_mode": "true",
            "vapi_api_key": "4a6e1673-0d93-4046-866f-504298150d11",
            "vapi_public_key": "af72d179-ed4c-4421-8bd1-b600f6559461",
            "proxycurl_api_key": "",
            "vapi_assistant_id": "",
            "twilio_sid": "",
            "twilio_token": "",
            "smtp_host": "smtp.gmail.com",
            "smtp_port": "587",
            "smtp_user": "",
            "smtp_password": "",
            "smtp_sender": "sales@company.com",
            "whatsapp_token": "",
            "whatsapp_phone_number_id": "",
            "whatsapp_template_name": "outreach_followup",
            "google_sheet_id": "",
            "google_sheet_credentials": "",
            "system_prompt": "You are Sarah, an AI Sales Representative. Your goal is to pitch our cloud migration and IT services to IT leaders, handle objections professionally, and guide them to booking a 15-minute discovery call.",
            "linkedin_daily_limit": "5",
            "email_followup_delay_hours": "48"
        }
        for k, v in default_settings.items():
            existing = db.query(Setting).filter(Setting.key == k).first()
            if not existing:
                db.add(Setting(key=k, value=v))
        db.commit()
    finally:
        db.close()
