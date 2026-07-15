import os
import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# 1. Override the database URL in the database module before other imports
import database
database.DATABASE_URL = "sqlite:///./test_sdr.db"
database.engine = create_engine(database.DATABASE_URL, connect_args={"check_same_thread": False})
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from database import Base, Lead, Setting, Log
import scraper
from services import google_sheets, outreach

class TestAISDR(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create database structure on the physical test file
        Base.metadata.create_all(bind=database.engine)

    @classmethod
    def tearDownClass(cls):
        # Clean up database structure and file
        Base.metadata.drop_all(bind=database.engine)
        if os.path.exists("./test_sdr.db"):
            try:
                os.remove("./test_sdr.db")
            except Exception as e:
                print(f"Error removing test db file: {e}")

    def setUp(self):
        self.db = database.SessionLocal()
        # Clean existing test data before each test
        self.db.query(Log).delete()
        self.db.query(Lead).delete()
        self.db.query(Setting).delete()
        self.db.commit()
        
        # Populate default settings
        default_settings = {
            "simulation_mode": "true",
            "system_prompt": "Test Prompt",
            "google_sheet_id": "test_sheet_id"
        }
        for k, v in default_settings.items():
            self.db.add(Setting(key=k, value=v))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_database_creation(self):
        sim_setting = self.db.query(Setting).filter(Setting.key == "simulation_mode").first()
        self.assertEqual(sim_setting.value, "true")

    def test_scraper_simulation(self):
        count = scraper.run_scraper(self.db)
        self.assertTrue(count >= 40 and count <= 50)
        
        leads_in_db = self.db.query(Lead).all()
        self.assertEqual(len(leads_in_db), count)
        
        lead = leads_in_db[0]
        self.assertEqual(lead.status, "scraped")
        self.assertEqual(lead.call_status, "none")
        self.assertIsNotNone(lead.email)
        self.assertIsNotNone(lead.phone)

    def test_lead_approval_and_outreach_simulation(self):
        # Create a lead
        lead = Lead(
            name="Vikram Patel",
            email="vikram@wority.com",
            phone="+91 9876543210",
            company="Wority IT Solutions",
            title="CEO",
            status="scraped"
        )
        self.db.add(lead)
        self.db.commit()
        
        self.assertEqual(lead.status, "scraped")
        
        # Approve lead
        lead.status = "approved"
        self.db.commit()
        self.assertEqual(lead.status, "approved")
        
        # Trigger outreach call simulation (this will update status to 'calling' and trigger async thread)
        res = outreach.trigger_vapi_call(self.db, lead.id)
        self.assertEqual(res["status"], "success")
        
        # In test context, we want to run the simulation lifecycle synchronously to check outputs
        # We manually call the worker function but bypass its time.sleep to run instantly
        # Let's temporarily mock time.sleep or call the function directly.
        # Since it runs a sleep inside, it will take 6+2+2 = 10s, which is fine for tests, 
        # but to speed up we can just run it. The function runs sleep(6) then updates.
        outreach.simulate_vapi_call_lifecycle(lead.id)
        
        # Refresh session to fetch latest changes written by the worker
        self.db.expire_all()
        
        lead_refreshed = self.db.query(Lead).filter(Lead.id == lead.id).first()
        self.assertEqual(lead_refreshed.call_status, "completed")
        self.assertIn(lead_refreshed.call_outcome, ["interested", "voicemail", "not_interested"])
        self.assertEqual(lead_refreshed.email_status, "sent")
        self.assertEqual(lead_refreshed.whatsapp_status, "sent")

    def test_linkedin_throttling_and_sequencing(self):
        # 1. Verify limit of 5 connection requests per day
        # Create 8 approved leads
        for i in range(8):
            lead = Lead(
                name=f"Lead {i}",
                email=f"lead{i}@domain.com",
                phone=f"+91 999999900{i}",
                company=f"Company {i}",
                status="approved"
            )
            self.db.add(lead)
        self.db.commit()
        
        # Verify Daily Queue processing respects limit of 5 (since it's configured in default settings)
        queued_count = outreach.process_daily_linkedin_queue(self.db)
        self.assertEqual(queued_count, 5)
        
        # 2. Mark one request as SENT
        queued_leads = self.db.query(Lead).filter(Lead.linkedin_status == "queued").all()
        target_lead = queued_leads[0]
        outreach.mark_linkedin_sent(self.db, target_lead.id)
        
        self.db.expire_all()
        self.assertEqual(target_lead.linkedin_status, "request_sent")
        self.assertIsNotNone(target_lead.linkedin_sent_date)
        
        # 3. Simulate Connection ACCEPTED (triggers Email 1)
        outreach.handle_linkedin_acceptance(self.db, target_lead.id)
        
        self.db.expire_all()
        self.assertEqual(target_lead.linkedin_status, "accepted")
        self.assertEqual(target_lead.email_sequence_step, 1)
        self.assertEqual(target_lead.email_status, "sent")
        self.assertIsNotNone(target_lead.last_email_sent_date)
        
        # 4. Trigger cron check without timeout -> should not send Email 2
        followup_count = outreach.check_sequencing_timeouts(self.db)
        self.assertEqual(followup_count, 0)
        
        # 5. Set Email 1 sent date back 50 hours to simulate timeout
        from datetime import datetime, timedelta
        target_lead.last_email_sent_date = datetime.utcnow() - timedelta(hours=50)
        self.db.commit()
        
        # Trigger cron check -> should send Email 2
        followup_count = outreach.check_sequencing_timeouts(self.db)
        self.assertEqual(followup_count, 1)
        self.db.expire_all()
        self.assertEqual(target_lead.email_sequence_step, 2)
        
        # 6. Verify that replying halts subsequent sequences
        target_lead.email_sequence_step = 1
        target_lead.last_email_sent_date = datetime.utcnow() - timedelta(hours=50)
        target_lead.response_received = True
        self.db.commit()
        
        followup_count = outreach.check_sequencing_timeouts(self.db)
        self.assertEqual(followup_count, 0)

        # 7. Test connection auto-detection with mock/sandbox Proxycurl
        sent_lead = Lead(
            name="Sent Lead",
            email="sent@domain.com",
            phone="+91 9999999010",
            company="Sent Company",
            status="approved",
            linkedin_status="request_sent",
            linkedin_url="https://linkedin.com/in/sent-lead"
        )
        self.db.add(sent_lead)
        self.db.commit()
        
        self.db.merge(Setting(key="proxycurl_api_key", value="sandbox"))
        self.db.commit()
        
        import unittest.mock
        with unittest.mock.patch('random.random', return_value=0.1):
            detected_count = outreach.check_linkedin_connections_automation(self.db)
            self.assertEqual(detected_count, 1)
            
        self.db.expire_all()
        self.assertEqual(sent_lead.linkedin_status, "accepted")

if __name__ == "__main__":
    unittest.main()


