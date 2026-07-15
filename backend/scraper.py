import random
import datetime
from sqlalchemy.orm import Session
from database import Lead, Log, Setting

# Mock data sets for realistic lead generation
FIRST_NAMES = ["Amit", "Rahul", "Priya", "Sneha", "Vikram", "Deepak", "Anjali", "Sanjay", "Neha", "Rohan", 
               "Rajesh", "Kiran", "Arjun", "Aditi", "Manish", "Divya", "Suresh", "Pooja", "Vijay", "Aishwarya"]
LAST_NAMES = ["Patel", "Sharma", "Mehta", "Joshi", "Shah", "Gupta", "Verma", "Rao", "Nair", "Choudhury",
              "Singh", "Reddy", "Mishra", "Kumar", "Deshmukh", "Iyer", "Sen", "Bose", "Trivedi", "Vyas"]
COMPANIES = [
    "Tech Mahindra", "InfoStretch", "Gateway Group", "TatvaSoft", "eInfochips", "Radixweb", "SPEC India",
    "Zeus Learning", "Cygnet Infotech", "Synoptek", "Helios Solutions", "Hidden Brains", "Mindtree",
    "Persistent Systems", "LTIMindtree", "Coforge", "Hexaware", "Zensar Tech", "Mastek", "Birlasoft"
]
TITLES = ["CTO", "Director of IT", "IT Manager", "Head of Engineering", "VP of Technology", "Infrastructure Manager", "VP of Operations"]
DOMAINS = ["techmahindra.com", "infostretch.com", "gatewaygroup.com", "tatvasoft.com", "einfochips.com", "radixweb.com", "specindia.com", 
           "zeuslearning.com", "cygnetinfotech.com", "synoptek.com", "heliossolutions.com", "hiddenbrains.com", "mindtree.com", 
           "persistent.com", "ltimindtree.com", "coforge.com", "hexaware.com", "zensar.com", "mastek.com", "birlasoft.com"]
SOURCES = ["LinkedIn", "Clutch Directory", "Google Maps/YellowPages"]

def generate_mock_leads(count=45):
    leads = []
    for i in range(count):
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        company_idx = random.randint(0, len(COMPANIES) - 1)
        company = COMPANIES[company_idx]
        domain = DOMAINS[company_idx]
        
        name = f"{first} {last}"
        email = f"{first.lower()}.{last.lower()}@{domain}"
        
        # Realistic Indian Mobile Numbers (9xxxxxxxxx / 8xxxxxxxxx / 7xxxxxxxxx)
        phone = f"+91 {random.choice([7, 8, 9])}{random.randint(10000000, 99999999)}"
        title = random.choice(TITLES)
        source = random.choice(SOURCES)
        
        leads.append({
            "name": name,
            "email": email,
            "phone": phone,
            "company": company,
            "title": title,
            "source": source
        })
    return leads

def run_scraper(db: Session):
    # Check if we are in simulation mode
    sim_mode_setting = db.query(Setting).filter(Setting.key == "simulation_mode").first()
    is_simulation = sim_mode_setting.value.lower() == "true" if sim_mode_setting else True

    print(f"Starting scraper run. Simulation Mode: {is_simulation}")
    
    scraped_count = 0
    new_leads = []
    
    if is_simulation:
        # Generate and save mock leads
        mock_leads = generate_mock_leads(random.randint(40, 50))
        for lead_data in mock_leads:
            # Check if lead already exists by email
            existing = db.query(Lead).filter(Lead.email == lead_data["email"]).first()
            if not existing:
                lead = Lead(
                    name=lead_data["name"],
                    email=lead_data["email"],
                    phone=lead_data["phone"],
                    company=lead_data["company"],
                    title=lead_data["title"],
                    source=lead_data["source"],
                    status="scraped",
                    call_status="none",
                    call_outcome="none"
                )
                db.add(lead)
                db.flush()  # Populates lead.id
                
                # Create audit log
                log = Log(
                    lead_id=lead.id,
                    action="Scraped",
                    details=f"Lead scraped from {lead_data['source']}. Job Title: {lead_data['title']}"
                )
                db.add(log)
                new_leads.append(lead)
                scraped_count += 1
        db.commit()
    else:
        # Real Playwright Scraper Implementation Boilerplate
        # In a real environment, you would run playwright here:
        # from playwright.sync_api import sync_playwright
        # with sync_playwright() as p:
        #     browser = p.chromium.launch(headless=True)
        #     ... scrape Logic ...
        # For this Phase 1 project, we fallback gracefully to simulated scraping if Playwright fails or isn't installed.
        try:
            from playwright.sync_api import sync_playwright
            # Example scraping logic for a public directory:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.goto("https://clutch.co/in/it-services")
                # Parse listings and pull lead targets...
                browser.close()
        except Exception as e:
            print(f"Real scraper error or Playwright not installed. Falling back to mock scraper: {str(e)}")
            return run_scraper_fallback(db)
            
    print(f"Scraper completed. Saved {scraped_count} new leads.")
    return scraped_count

def run_scraper_fallback(db: Session):
    mock_leads = generate_mock_leads(5) # small batch for fallback
    scraped_count = 0
    for lead_data in mock_leads:
        existing = db.query(Lead).filter(Lead.email == lead_data["email"]).first()
        if not existing:
            lead = Lead(
                name=lead_data["name"],
                email=lead_data["email"],
                phone=lead_data["phone"],
                company=lead_data["company"],
                title=lead_data["title"],
                source=lead_data["source"] + " (Scraper Fallback)",
                status="scraped"
            )
            db.add(lead)
            db.flush()
            log = Log(
                lead_id=lead.id,
                action="Scraped",
                details=f"Lead scraped via Fallback. Job Title: {lead_data['title']}"
            )
            db.add(log)
            scraped_count += 1
    db.commit()
    return scraped_count
