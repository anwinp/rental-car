#!/usr/bin/env python3
"""
Realistic dataset seed for Rental Car Manager.

Synthesized from three-agent debate:
  - Product analyst: what every page needs
  - Operations expert: industry-accurate ratios
  - DBA: schema constraints and FK ordering

Targets (net new on top of preserved rows):
  customers    : +100  (111 total)
  staff_users  : +40   (52 total)
  reservations : 600   (truncate & rebuild)
  rental_agreements: ~360 (truncate & rebuild)
  payments     : ~420  (truncate & rebuild)
  shift_logs   : 300+  (truncate & rebuild)
  damage_claims: 30    (truncate & rebuild)
  vehicle_blocks: 60   (truncate & rebuild)
  ota_channels : 6     (truncate & rebuild)
  rate_codes   : +3    (WEEKLY, WEEKEND, CORPORATE)
"""

import asyncio
import asyncpg
import bcrypt
import random
import string
import uuid
from datetime import datetime, timedelta, date, timezone
from decimal import Decimal, ROUND_HALF_UP
import json

DSN = "postgresql://rcm:rcm_dev_password@127.0.0.1:5434/rcm_dev"
TENANT_ID = "00000000-0000-0000-0000-000000000001"
NOW = datetime.now(timezone.utc)

# ── Fixed IDs from live DB ────────────────────────────────────────────────────
LOC = {
    "BOS": "00000000-0000-0000-0002-000000000001",
    "JFK": "00000000-0000-0000-0002-000000000002",
    "ORD": "00000000-0000-0000-0002-000000000003",
    "MIA": "00000000-0000-0000-0002-000000000004",
    "SFO": "00000000-0000-0000-0002-000000000005",
    "DFW": "00000000-0000-0000-0002-000000000006",
    "LAX": "d3e140bb-29f0-453a-b5af-a989d7d40844",
    "SJC": "6861120d-857a-4003-824b-2256a2088b86",
}

CLASS = {
    "M": "00000000-0000-0000-0001-000000000001",   # Mini
    "E": "00000000-0000-0000-0001-000000000002",   # Economy
    "C": "00000000-0000-0000-0001-000000000003",   # Compact
    "I": "00000000-0000-0000-0001-000000000004",   # Intermediate
    "S": "00000000-0000-0000-0001-000000000005",   # Standard
    "F": "00000000-0000-0000-0001-000000000006",   # Fullsize
    "P": "00000000-0000-0000-0001-000000000007",   # Premium
    "L": "00000000-0000-0000-0001-000000000008",   # Luxury
    "U": "00000000-0000-0000-0001-000000000009",   # SUV
    "V": "00000000-0000-0000-0001-000000000010",   # Minivan
    "W": "00000000-0000-0000-0001-000000000011",   # Wagon/Estate
    "X": "00000000-0000-0000-0001-000000000012",   # Special/Exotic
}

EXTRAS = {
    "CDW":  "00000000-0000-0000-0002-000000000001",
    "LDW":  "00000000-0000-0000-0002-000000000002",
    "SLI":  "00000000-0000-0000-0002-000000000003",
    "PAI":  "00000000-0000-0000-0002-000000000004",
    "RSA":  "00000000-0000-0000-0002-000000000005",
    "GPS":  "00000000-0000-0000-0002-000000000006",
    "CSS":  "00000000-0000-0000-0002-000000000007",
    "TOLL": "00000000-0000-0000-0002-000000000008",
    "PPFP": "00000000-0000-0000-0002-000000000009",
}

EXTRA_DAILY_RATES = {
    "CDW": 19.99, "LDW": 14.99, "SLI": 8.99, "PAI": 4.99,
    "RSA": 3.99,  "GPS": 7.99,  "CSS": 9.99, "TOLL": 5.99, "PPFP": 8.49,
}

RACK_RATE_CODE_ID = "81c00ac4-4a20-4b13-9b16-c96133bd3a78"

# Existing staff IDs we must preserve
EXISTING_STAFF = {
    "counter@rcm.com":     "0605a6bb-d082-4844-a76c-0d8534b66244",
    "agent@rcm.com":       "c85181f3-c1fa-4284-9ab9-88f523cf28ad",
    "manager@rcm.com":     "81d91f81-fc87-4472-a5d0-98205bcb163e",
    "director@rcm.com":    "5f55515d-9416-40cd-82af-1abe2c7f2550",
    "fleet@rcm.com":       "2baad9f5-4060-4523-9aa2-d8161bc02bb1",
    "maintenance@rcm.com": "62f29226-7a0c-42e4-aa6b-1327c5a67366",
    "claims@rcm.com":      "2fde146a-30ee-4121-9fb2-4b8488785022",
    "admin@test.com":      "00000000-0000-0000-0001-000000000001",
    "superadmin@rcm.com":  "ce50673d-c31f-4a96-8589-5ffd553e0e60",
    "ceo@rcm.com":         "e6171c68-9161-47a6-8194-6a2cd7454931",
    "auditor@rcm.com":     "71ec4c7f-5d8b-4277-9cd7-ce462aeb515b",
    "finance@rcm.com":     "4cb7fa16-de50-485e-bcd7-84909ad91d7b",
}

# ── Rate data ─────────────────────────────────────────────────────────────────
RACK_RATES = {
    "M": 32, "E": 41, "C": 48, "I": 58, "S": 67, "F": 75,
    "P": 185, "L": 145, "U": 98, "V": 82, "W": 55, "X": 295,
}
WEEKEND_MULT = {"M": 0.88, "E": 0.88, "C": 0.90, "I": 0.90, "S": 0.90, "F": 0.91,
                "P": 0.95, "L": 0.94, "U": 1.06, "V": 1.08, "W": 0.92, "X": 1.05}
WEEKLY_MULT  = {k: 0.85 for k in RACK_RATES}
CORP_MULT    = {k: 0.88 for k in RACK_RATES}

# ── Helpers ───────────────────────────────────────────────────────────────────
RNG = random.Random(42)

def uid():
    return str(uuid.uuid4())

def conf_num(dt: datetime) -> str:
    suffix = "".join(RNG.choices(string.ascii_uppercase + string.digits, k=6))
    return f"RCM-{dt.strftime('%Y%m%d')}-{suffix}"

def ra_num(dt: datetime) -> str:
    suffix = "".join(RNG.choices(string.ascii_uppercase + string.digits, k=5))
    return f"RA-{dt.strftime('%Y%m%d')}-{suffix}"

def claim_ref(dt: datetime) -> str:
    suffix = "".join(RNG.choices(string.ascii_uppercase + string.digits, k=5))
    return f"CLM-{dt.strftime('%Y%m%d')}-{suffix}"

def rand_vin(prefix: str) -> str:
    chars = string.ascii_uppercase.replace("I","").replace("O","").replace("Q","") + string.digits
    body = "".join(RNG.choices(chars, k=17 - len(prefix)))
    return (prefix + body)[:17]

def rand_plate(state_abbr: str) -> str:
    digits = "".join(RNG.choices(string.digits, k=4))
    letters = "".join(RNG.choices(string.ascii_uppercase, k=3))
    return f"{state_abbr}{digits}{letters}"

def bcrypt_hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()

def weighted_choice(options, weights):
    return RNG.choices(options, weights=weights, k=1)[0]

def days_ago(n): return NOW - timedelta(days=n)
def days_fwd(n):  return NOW + timedelta(days=n)

def reservation_date_for_period(period: str) -> datetime:
    """Returns a random pickup_datetime based on volume index periods."""
    ranges = [
        (150, 90, 0.78),
        (90,  60, 0.91),
        (60,  30, 1.00),
        (30,  14, 1.12),
        (14,   1, 1.18),
        (-1, -14, 1.08),  # future
        (-14,-30, 0.85),
        (-30,-60, 0.52),
    ]
    weights = [r[2] for r in ranges]
    chosen = RNG.choices(ranges, weights=weights, k=1)[0]
    past_start, past_end = chosen[0], chosen[1]
    if past_start > 0:
        offset = RNG.randint(past_end, past_start)
        dt = NOW - timedelta(days=offset)
    else:
        fwd_start = abs(past_start)
        fwd_end   = abs(past_end)
        offset = RNG.randint(fwd_start, fwd_end)
        dt = NOW + timedelta(days=offset)

    hour = RNG.choices(range(6, 22), weights=[1,2,3,4,5,5,6,6,5,5,4,4,4,3,3,2], k=1)[0]
    minute = RNG.choice([0, 15, 30, 45])
    return dt.replace(hour=hour, minute=minute, second=0, microsecond=0)

LOCATION_STATES = {
    "BOS": "MA", "JFK": "NY", "ORD": "IL", "MIA": "FL",
    "SFO": "CA", "DFW": "TX", "LAX": "CA", "SJC": "CA",
}
AIRLINE_PREFIXES = ["AA", "UA", "DL", "WN", "B6", "AS", "F9", "NK"]

FIRST_NAMES = [
    "James","John","Robert","Michael","William","David","Richard","Joseph","Thomas","Charles",
    "Christopher","Daniel","Matthew","Anthony","Mark","Donald","Steven","Paul","Andrew","Joshua",
    "Mary","Patricia","Jennifer","Linda","Barbara","Elizabeth","Susan","Jessica","Sarah","Karen",
    "Lisa","Nancy","Betty","Margaret","Sandra","Ashley","Dorothy","Kimberly","Emily","Donna",
    "Olivia","Emma","Ava","Isabella","Sophia","Mia","Charlotte","Amelia","Harper","Evelyn",
    "Lucas","Mason","Ethan","Liam","Noah","Aiden","Caden","Jackson","Sebastian","Mateo",
    "Ana","Elena","Sofia","Valentina","Camila","Lucia","Natalia","Isabella","Maria","Rosa",
    "Wei","Yuki","Kenji","Priya","Arjun","Rahul","Mei","Xia","Jin","Ravi",
    "Ahmed","Fatima","Hassan","Layla","Omar","Aisha","Tariq","Nour","Yasmin","Karim",
]
LAST_NAMES = [
    "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
    "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
    "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
    "Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
    "Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts",
    "Chen","Kim","Patel","Singh","Kumar","Sharma","Ali","Ahmed","Hassan","Khan",
    "Murphy","O'Brien","Walsh","Ryan","O'Connor","Kelly","Burke","McCarthy","Collins","Hayes",
    "Weber","Mueller","Fischer","Hoffmann","Schulz","Koch","Becker","Richter","Wolf","Schroeder",
]

MAKES_BY_CLASS = {
    "M": [("Chevrolet","Spark"),("Fiat","500"),("Mitsubishi","Mirage"),("Kia","Rio")],
    "E": [("Toyota","Corolla"),("Honda","Civic"),("Hyundai","Elantra"),("Nissan","Sentra"),("Mazda","3")],
    "C": [("Volkswagen","Jetta"),("Toyota","Camry"),("Honda","Accord"),("Chevrolet","Malibu")],
    "I": [("Ford","Fusion"),("Hyundai","Sonata"),("Kia","Optima"),("Dodge","Avenger")],
    "S": [("Toyota","Camry XSE"),("Honda","Accord Sport"),("Nissan","Altima"),("Chevrolet","Impala")],
    "F": [("Chrysler","300"),("Dodge","Charger"),("Ford","Taurus"),("Chevrolet","Caprice")],
    "P": [("BMW","3 Series"),("Audi","A4"),("Mercedes-Benz","C-Class"),("Cadillac","CT5")],
    "L": [("BMW","5 Series"),("Audi","A6"),("Mercedes-Benz","E-Class"),("Lexus","ES 350")],
    "U": [("Toyota","RAV4"),("Honda","CR-V"),("Ford","Explorer"),("Chevrolet","Equinox"),("Jeep","Grand Cherokee")],
    "V": [("Chrysler","Pacifica"),("Honda","Odyssey"),("Toyota","Sienna"),("Kia","Carnival")],
    "W": [("Volvo","V60"),("Audi","A4 Allroad"),("Subaru","Outback"),("Volkswagen","Golf Wagon")],
    "X": [("Ferrari","Roma"),("Lamborghini","Urus"),("Porsche","911"),("BMW","M5"),("Mercedes-Benz","AMG GT")],
}

FUEL_BY_MAKE = {
    "Toyota": "HYBRID", "Honda": "GASOLINE", "Ford": "GASOLINE",
    "Chevrolet": "GASOLINE", "BMW": "GASOLINE", "Audi": "GASOLINE",
    "Mercedes-Benz": "GASOLINE", "Lexus": "HYBRID", "Volvo": "PHEV",
    "Kia": "GASOLINE", "Hyundai": "GASOLINE", "Nissan": "GASOLINE",
    "Mazda": "GASOLINE", "Volkswagen": "GASOLINE", "Jeep": "GASOLINE",
    "Subaru": "GASOLINE", "Dodge": "GASOLINE", "Chrysler": "GASOLINE",
    "Mitsubishi": "GASOLINE", "Fiat": "GASOLINE", "Cadillac": "GASOLINE",
    "Ferrari": "GASOLINE", "Lamborghini": "GASOLINE", "Porsche": "GASOLINE",
}

DAMAGE_ZONES = ["FRONT_BUMPER","REAR_BUMPER","DRIVER_DOOR","PASSENGER_DOOR",
                "HOOD","ROOF","TRUNK","WINDSHIELD","LEFT_REAR_QUARTER","RIGHT_REAR_QUARTER",
                "DRIVER_MIRROR","PASSENGER_MIRROR","INTERIOR_SEAT","INTERIOR_FLOOR"]
DAMAGE_TYPES = ["SCRATCH","DENT","CRACK","CHIP","TEAR","STAIN","BURN","MISSING_PART","FLOOD"]
DISCOVERY_TYPES = ["RETURN_INSPECTION","POST_RETURN_AUDIT","MID_RENTAL_CUSTOMER_REPORT","THIRD_PARTY_REPORT"]
CLAIM_TYPES = ["CUSTOMER_CHARGE","CDW_WAIVER","THIRD_PARTY_INSURANCE","CREDIT_CARD_BENEFIT","OPERATOR_ABSORBED"]
CLAIM_STATUSES = ["OPEN","ESTIMATE_SENT","CUSTOMER_ACKNOWLEDGED","REPAIR_IN_PROGRESS","REPAIR_COMPLETE","INVOICED","PAID"]

OTA_PARTNERS = [
    {"channel_name": "EXPEDIA",     "property_id": "RCM-EXP-001", "api_key": "exp_test_key_001"},
    {"channel_name": "BOOKING_COM", "property_id": "RCM-BKG-001", "api_key": "bkg_test_key_001"},
]

BLOCK_NOTES_BY_TYPE = {
    "MAINTENANCE": [
        "Scheduled oil change & tire rotation",
        "30,000 mile service — brake inspection + fluid flush",
        "AC system recharge — compressor noise reported by last renter",
        "Recall notice: airbag inflator replacement (NHTSA #2026-0033)",
        "Transmission fluid change — slipping reported",
        "Check engine light — O2 sensor replacement",
        "Wheel alignment + 4-wheel balance",
    ],
    "INSPECTION": [
        "Post-rental inspection — customer-reported door ding",
        "Annual DOT safety inspection",
        "Pre-fleet vehicle inspection — new acquisition",
        "Insurance company inspection — claim #CLM-2026",
        "Odometer verification inspection",
    ],
    "RECALL_HOLD": [
        "NHTSA Recall: fuel pump relay — parts on order",
        "Manufacturer recall: airbag sensor — dealer appointment scheduled",
        "Safety recall: brake line corrosion — pending parts",
    ],
    "IN_TRANSIT": [
        "En route from SFO to LAX (fleet rebalancing)",
        "Transfer to JFK for peak summer demand",
        "Moving to ORD for maintenance partner",
        "Fleet repositioning — MIA to BOS seasonal transfer",
    ],
    "INSPECTION_TURNAROUND": [
        "Quick turnaround — fuel + wash before next rental",
        "Express detail + damage photo documentation",
        "Turnaround cleaning after early return",
    ],
}

# ── Main seed ─────────────────────────────────────────────────────────────────
async def main():
    conn = await asyncpg.connect(DSN)
    try:
        print("=== RCM Realistic Seed ===")
        await seed(conn)
        print("\n✓ Seed complete.")
    finally:
        await conn.close()


async def seed(conn):
    # 1. Pre-generate bcrypt hashes (expensive — do once)
    print("Hashing passwords...")
    hashes = {
        "Counter123!":  bcrypt_hash("Counter123!"),
        "Manager123!":  bcrypt_hash("Manager123!"),
        "Fleet123!":    bcrypt_hash("Fleet123!"),
        "Claims123!":   bcrypt_hash("Claims123!"),
        "Finance123!":  bcrypt_hash("Finance123!"),
        "Admin123!":    bcrypt_hash("Admin123!"),
    }

    # 2. Clean up garbage vehicles, truncate transactional tables
    print("Cleaning transactional tables...")
    for tbl in ["damage_claims","payments","rental_agreements","reservation_versions",
                "reservations","vehicle_blocks","vehicle_status_log",
                "shift_logs","ota_leads","ota_channels"]:
        await conn.execute(f"DELETE FROM {tbl} WHERE tenant_id = $1", TENANT_ID)

    await conn.execute("""
        DELETE FROM vehicles WHERE make IN ('DupMake','TestMake','PlateDup','UpdateMake','TransitionMake','PlateMake')
          AND tenant_id = $1;
    """, TENANT_ID)

    # 3. Fetch remaining vehicle IDs grouped by class
    vehicle_rows = await conn.fetch("""
        SELECT vehicle_id, vehicle_class_id, current_location_id, make, model, model_year, vin
        FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY vehicle_class_id, current_location_id
    """, TENANT_ID)

    # Update all vehicles to AVAILABLE + fix plate numbers where missing
    print(f"Updating {len(vehicle_rows)} vehicles to AVAILABLE + adding plate numbers...")
    loc_states = {v: k for k, v in LOC.items()}  # loc_id → airport code

    await conn.execute("""
        UPDATE vehicles SET status = 'AVAILABLE', fuel_level_pct = $1
        WHERE tenant_id = $2 AND deleted_at IS NULL
    """, 100, TENANT_ID)

    for vrow in vehicle_rows:
        if not vrow["vin"] or vrow["vin"].startswith("TEST") or not vrow["vin"].strip():
            new_vin = rand_vin("1")
            await conn.execute("UPDATE vehicles SET vin = $1 WHERE vehicle_id = $2", new_vin, vrow["vehicle_id"])

    # 4. Add new staff users
    print("Adding staff users...")
    new_staff_ids = await add_staff(conn, hashes)
    all_counter_ids = [EXISTING_STAFF["counter@rcm.com"], EXISTING_STAFF["agent@rcm.com"]] + [
        sid for loc, role, sid in new_staff_ids if role in ("COUNTER_AGENT","SENIOR_AGENT")
    ]
    all_staff_by_loc = {}  # loc_id → list of (role, user_id)
    for loc, role, sid in new_staff_ids:
        all_staff_by_loc.setdefault(loc, []).append((role, sid))

    # Add existing 12 to loc BOS (their current home)
    all_staff_by_loc.setdefault(LOC["BOS"], []).extend([
        ("COUNTER_AGENT", EXISTING_STAFF["counter@rcm.com"]),
        ("SENIOR_AGENT",  EXISTING_STAFF["agent@rcm.com"]),
        ("BRANCH_MANAGER",EXISTING_STAFF["manager@rcm.com"]),
        ("FLEET_MANAGER", EXISTING_STAFF["fleet@rcm.com"]),
        ("MAINTENANCE_TECH", EXISTING_STAFF["maintenance@rcm.com"]),
        ("CLAIMS_COORDINATOR", EXISTING_STAFF["claims@rcm.com"]),
    ])

    # 5. Add customers
    print("Adding customers...")
    customer_ids = await add_customers(conn)

    # 6. Add rate codes
    print("Adding rate codes...")
    rate_code_ids = await add_rate_codes(conn)

    # 7. Add OTA channels
    print("Adding OTA channels...")
    ota_channel_ids = await add_ota_channels(conn)

    # 8. Generate reservations (rebuild, 600 target)
    print("Generating 600 reservations...")
    vehicle_by_class = {}
    for vrow in vehicle_rows:
        cid = vrow["vehicle_class_id"]
        vehicle_by_class.setdefault(cid, []).append(vrow)

    # Re-fetch after vin updates
    vehicle_rows = await conn.fetch("""
        SELECT vehicle_id, vehicle_class_id, current_location_id, vin, plate_number
        FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL
    """, TENANT_ID)
    vehicle_by_class = {}
    for vrow in vehicle_rows:
        cid = vrow["vehicle_class_id"]
        vehicle_by_class.setdefault(cid, []).append(dict(vrow))

    reservations = await generate_reservations(
        conn, customer_ids, vehicle_by_class, rate_code_ids, ota_channel_ids, all_staff_by_loc
    )

    # 9. Generate rental agreements + payments for completed/active reservations
    print("Generating rental agreements and payments...")
    claims_source_ras = await generate_ra_and_payments(conn, reservations, vehicle_by_class, all_staff_by_loc)

    # 10. Generate shift logs
    print("Generating shift logs (~300)...")
    await generate_shift_logs(conn, all_staff_by_loc)

    # 11. Generate damage claims
    print("Generating damage claims (~30)...")
    await generate_damage_claims(conn, claims_source_ras, customer_ids)

    # 12. Generate vehicle blocks (maintenance, inspections)
    print("Generating vehicle blocks...")
    await generate_vehicle_blocks(conn, vehicle_rows, all_staff_by_loc)

    # 13. Mark promo vehicles
    print("Setting promo vehicles...")
    await set_promo_vehicles(conn, vehicle_rows)

    print(f"\nSummary:")
    for tbl in ["customers","staff_users","reservations","rental_agreements","payments","shift_logs","damage_claims","vehicle_blocks","ota_channels"]:
        cnt = await conn.fetchval(f"SELECT COUNT(*) FROM {tbl} WHERE tenant_id = $1", TENANT_ID)
        print(f"  {tbl:<22}: {cnt}")


# ── Staff generation ──────────────────────────────────────────────────────────
LOCATION_STAFFING = {
    "LAX": {"COUNTER_AGENT": 5, "SENIOR_AGENT": 2, "BRANCH_MANAGER": 1, "FLEET_MANAGER": 1, "MAINTENANCE_TECH": 1, "CLAIMS_COORDINATOR": 1},
    "JFK": {"COUNTER_AGENT": 5, "SENIOR_AGENT": 2, "BRANCH_MANAGER": 1, "FLEET_MANAGER": 1, "MAINTENANCE_TECH": 1, "CLAIMS_COORDINATOR": 1},
    "ORD": {"COUNTER_AGENT": 4, "SENIOR_AGENT": 2, "BRANCH_MANAGER": 1, "FLEET_MANAGER": 1, "MAINTENANCE_TECH": 1, "CLAIMS_COORDINATOR": 1},
    "DFW": {"COUNTER_AGENT": 4, "SENIOR_AGENT": 2, "BRANCH_MANAGER": 1, "FLEET_MANAGER": 1, "MAINTENANCE_TECH": 1},
    "MIA": {"COUNTER_AGENT": 3, "SENIOR_AGENT": 1, "BRANCH_MANAGER": 1, "FLEET_MANAGER": 1},
    "SFO": {"COUNTER_AGENT": 3, "SENIOR_AGENT": 1, "BRANCH_MANAGER": 1, "FLEET_MANAGER": 1},
    # BOS already has 6 from existing staff; add minimal
    "BOS": {"COUNTER_AGENT": 2, "SENIOR_AGENT": 1},
    "SJC": {"COUNTER_AGENT": 2, "SENIOR_AGENT": 1, "BRANCH_MANAGER": 1},
}

async def add_staff(conn, hashes):
    existing_emails = set(EXISTING_STAFF.keys())
    new_ids = []
    for airport, roles in LOCATION_STAFFING.items():
        loc_id = LOC[airport]
        state = LOCATION_STATES[airport]
        for role, count in roles.items():
            pw = "Counter123!" if role in ("COUNTER_AGENT","SENIOR_AGENT") else "Manager123!"
            for i in range(count):
                fn = RNG.choice(FIRST_NAMES)
                ln = RNG.choice(LAST_NAMES)
                base_email = f"{fn.lower()}.{ln.lower()}{i+1}@rcmfleet.com"
                # avoid duplicate emails
                if base_email in existing_emails:
                    base_email = f"{fn.lower()}{RNG.randint(100,999)}@rcmfleet.com"
                existing_emails.add(base_email)
                sid = uid()
                await conn.execute("""
                    INSERT INTO staff_users (
                        user_id, tenant_id, email, password_hash, first_name, last_name,
                        role, is_active, home_location_id, location_ids, created_at, updated_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,NOW(),NOW())
                    ON CONFLICT (tenant_id, email) DO NOTHING
                """, sid, TENANT_ID, base_email, hashes[pw], fn, ln, role,
                    loc_id, json.dumps([loc_id]))
                # Fetch actual ID (handles conflict case)
                actual_id = await conn.fetchval(
                    "SELECT user_id FROM staff_users WHERE tenant_id=$1 AND email=$2", TENANT_ID, base_email
                )
                if actual_id:
                    new_ids.append((loc_id, role, str(actual_id)))
    return new_ids


# ── Customer generation ───────────────────────────────────────────────────────
LOYALTY_TIERS  = ["MEMBER","SILVER","GOLD","PLATINUM"]
LOYALTY_WEIGHTS = [52, 24, 16, 8]
KYC_STATUSES   = ["UNVERIFIED","TIER_1_COMPLETE","TIER_2_COMPLETE","FAILED"]
KYC_WEIGHTS    = [27, 35, 35, 3]
ACCT_TYPES     = ["INDIVIDUAL","CORPORATE_EMPLOYEE","TRAVEL_AGENT","INSURANCE_CLAIMANT"]
ACCT_WEIGHTS   = [72, 18, 6, 4]

LOYALTY_POINTS = {
    "MEMBER":   (0, 1200),
    "SILVER":   (800, 4500),
    "GOLD":     (3000, 12000),
    "PLATINUM": (8000, 45000),
}

async def add_customers(conn):
    existing = await conn.fetch("SELECT customer_id FROM customers WHERE tenant_id = $1", TENANT_ID)
    ids = [str(r["customer_id"]) for r in existing]

    used_emails = set(r["email"] for r in await conn.fetch("SELECT email FROM customers WHERE tenant_id = $1", TENANT_ID))

    for _ in range(100):
        fn = RNG.choice(FIRST_NAMES)
        ln = RNG.choice(LAST_NAMES)
        email = f"{fn.lower()}.{ln.lower()}{RNG.randint(1,999)}@{RNG.choice(['gmail.com','yahoo.com','outlook.com','icloud.com','hotmail.com'])}"
        if email in used_emails:
            email = f"{fn.lower()}{uid()[:6]}@example.com"
        used_emails.add(email)

        tier = weighted_choice(LOYALTY_TIERS, LOYALTY_WEIGHTS)
        pts_range = LOYALTY_POINTS[tier]
        points = RNG.randint(*pts_range)
        kyc = weighted_choice(KYC_STATUSES, KYC_WEIGHTS)
        acct_type = weighted_choice(ACCT_TYPES, ACCT_WEIGHTS)
        dnr = RNG.random() < 0.021
        dnr_reason = RNG.choice(["Unpaid damage balance","Fraudulent booking","Vehicle returned with significant damage","Abusive behavior toward staff"]) if dnr else None
        phone = f"+1{RNG.randint(200,999)}{RNG.randint(100,999)}{RNG.randint(1000,9999)}"
        dob = date(RNG.randint(1960, 2000), RNG.randint(1,12), RNG.randint(1,28))
        license_exp = date(2026 + RNG.randint(0,4), RNG.randint(1,12), RNG.randint(1,28))
        states = ["CA","TX","NY","FL","IL","PA","OH","GA","NC","MI"]
        st = RNG.choice(states)
        license_num = "".join(RNG.choices(string.ascii_uppercase + string.digits, k=9))

        cid = uid()
        loyalty_num = f"RCM{cid.replace('-','')[:8].upper()}"
        await conn.execute("""
            INSERT INTO customers (
                customer_id, tenant_id, first_name, last_name, email, email_verified,
                mobile_phone, date_of_birth, account_status, account_type,
                kyc_status, loyalty_tier, loyalty_points, loyalty_number,
                dnr_flag, dnr_reason,
                license_number, license_country, license_state, license_class,
                license_expiry, created_at, updated_at
            ) VALUES (
                $1,$2,$3,$4,$5,true,$6,$7,'ACTIVE',$8,$9::kyc_status,$10,$11,$12,
                $13,$14,$15,'US',$16,'B',$17,NOW(),NOW()
            )
        """, cid, TENANT_ID, fn, ln, email, phone, dob, acct_type, kyc,
            tier, points, loyalty_num,
            dnr, dnr_reason,
            license_num, st, license_exp)
        ids.append(cid)

    return ids


# ── Rate codes ────────────────────────────────────────────────────────────────
async def add_rate_codes(conn):
    ids = {"RACK": RACK_RATE_CODE_ID}
    rate_defs = [
        ("WEEKLY",   "RACK",           WEEKLY_MULT,  "LEISURE",  7,   None),
        ("WEEKEND",  "WEEKEND_SPECIAL", WEEKEND_MULT, "LEISURE",  2,   4),
        ("CORPORATE","CORPORATE",       CORP_MULT,    "BUSINESS", 1,   None),
    ]
    for code, rate_type, mults, segment, min_days, max_days in rate_defs:
        existing = await conn.fetchval(
            "SELECT rate_code_id FROM rate_codes WHERE tenant_id=$1 AND code=$2", TENANT_ID, code
        )
        if existing:
            ids[code] = str(existing)
            continue
        rcid = uid()
        await conn.execute("""
            INSERT INTO rate_codes (
                rate_code_id, tenant_id, code, description, rate_type, currency,
                status, valid_from, valid_until,
                blackout_dates, day_of_week_modifiers,
                location_scope, location_ids, vehicle_class_scope, vehicle_class_ids,
                min_rental_days, max_rental_days,
                prepay_required, refundable, is_combinable, market_segment
            ) VALUES (
                $1,$2,$3,$4,$5::rate_type,'USD','ACTIVE',
                '2024-01-01','2030-12-31',
                '[]'::jsonb,'{}',
                'ALL','{}'::uuid[],'ALL','{}'::uuid[],
                $6,$7,false,true,false,$8
            )
        """, rcid, TENANT_ID, code, f"{code.title()} Rate", rate_type, min_days, max_days, segment)
        ids[code] = rcid

        # rate_schedule_items for all 12 classes
        for sipp, cid in CLASS.items():
            daily = round(RACK_RATES[sipp] * mults[sipp], 2)
            weekly = round(daily * 6.5, 2)
            monthly = round(daily * 25.0, 2)
            await conn.execute("""
                INSERT INTO rate_schedule_items (
                    item_id, tenant_id, rate_code_id, vehicle_class_id,
                    days_min, days_max, price_per_day, price_per_week, price_per_month,
                    location_id
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)
                ON CONFLICT DO NOTHING
            """, uid(), TENANT_ID, rcid, cid, min_days, max_days, daily, weekly, monthly)
    return ids


# ── OTA channels ──────────────────────────────────────────────────────────────
async def add_ota_channels(conn):
    ids = []
    for partner in OTA_PARTNERS:
        cid = uid()
        await conn.execute("""
            INSERT INTO ota_channels (
                channel_id, tenant_id, channel_name,
                api_key, api_secret, property_id,
                is_active, webhook_enabled
            ) VALUES ($1,$2,$3,$4,'',$5,true,false)
            ON CONFLICT (tenant_id, channel_name) DO NOTHING
        """, cid, TENANT_ID, partner["channel_name"],
            partner["api_key"], partner["property_id"])
        ids.append(cid)
    return ids


# ── Reservations ──────────────────────────────────────────────────────────────
STATUS_WEIGHTS  = [42, 28, 16, 11, 3]
STATUS_OPTIONS  = ["RETURNED","CONFIRMED","CHECKED_OUT","CANCELLED","NO_SHOW"]
CHANNEL_OPTIONS = ["DIRECT_WEB","OTA","CALL_CENTER","COUNTER"]
CHANNEL_WEIGHTS = [31, 38, 18, 13]
SIPP_LIST       = list(CLASS.keys())
SIPP_WEIGHTS    = [4, 12, 10, 9, 8, 7, 6, 5, 10, 6, 5, 3]  # rough popularity
LOC_LIST        = list(LOC.keys())
DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21]
DURATION_WEIGHTS = [9, 14, 14, 9, 8, 6, 12, 7, 11, 4] + [6]
# normalize
dur_sum = sum(DURATION_WEIGHTS[:10])
DURATION_WEIGHTS_NORM = [w/dur_sum for w in DURATION_WEIGHTS[:10]]

async def generate_reservations(conn, customer_ids, vehicle_by_class, rate_code_ids, ota_channel_ids, staff_by_loc):
    created = []
    used_conf_nums = set()

    # Allocate vehicle assignment pool for CHECKED_OUT reservations
    # We'll assign vehicles to CHECKED_OUT + some CONFIRMED upcoming
    vehicles_flat = [(v["vehicle_id"], v["vehicle_class_id"]) for vlist in vehicle_by_class.values() for v in vlist]

    for i in range(600):
        status = weighted_choice(STATUS_OPTIONS, STATUS_WEIGHTS)
        channel = weighted_choice(CHANNEL_OPTIONS, CHANNEL_WEIGHTS)
        sipp = weighted_choice(SIPP_LIST, SIPP_WEIGHTS)
        class_id = CLASS[sipp]
        pickup_loc = weighted_choice(LOC_LIST, [10,9,8,9,8,8,11,8])
        dropoff_loc = pickup_loc if RNG.random() < 0.85 else weighted_choice(LOC_LIST, [10,9,8,9,8,8,11,8])

        pickup_dt = reservation_date_for_period(status)
        duration = RNG.choices(DURATION_OPTIONS, weights=DURATION_WEIGHTS[:10], k=1)[0]

        # Adjust pickup date based on status
        if status == "RETURNED":
            # must be in the past, return also past
            if pickup_dt > NOW - timedelta(days=duration+1):
                pickup_dt = NOW - timedelta(days=RNG.randint(duration+2, duration+60))
            return_dt = pickup_dt + timedelta(days=duration)
            actual_return_dt = return_dt + timedelta(hours=RNG.randint(-2, 3))
        elif status == "CHECKED_OUT":
            # pickup in the past, return in future or past (some overdue)
            hours_ago = RNG.randint(4, 72)
            pickup_dt = NOW - timedelta(hours=hours_ago)
            # 25% chance overdue — return must be AFTER pickup but BEFORE now
            if RNG.random() < 0.25:
                overdue_hours = RNG.randint(2, min(hours_ago - 1, 96))
                return_dt = NOW - timedelta(hours=overdue_hours)
                if return_dt <= pickup_dt:
                    return_dt = pickup_dt + timedelta(hours=1)
            else:
                return_dt = NOW + timedelta(days=RNG.randint(1, duration))
            actual_return_dt = None
        elif status == "CONFIRMED":
            # pickup in the future
            if pickup_dt <= NOW:
                pickup_dt = NOW + timedelta(days=RNG.randint(1, 45))
            return_dt = pickup_dt + timedelta(days=duration)
            actual_return_dt = None
        else:  # CANCELLED, NO_SHOW
            actual_return_dt = None
            if pickup_dt <= NOW + timedelta(hours=1):
                return_dt = pickup_dt + timedelta(days=duration)
            else:
                return_dt = pickup_dt + timedelta(days=duration)

        # Creation date: some time before pickup
        lead_days = RNG.randint(0, 30)
        created_at = pickup_dt - timedelta(days=lead_days) - timedelta(hours=RNG.randint(0,23))
        if created_at > NOW:
            created_at = NOW - timedelta(minutes=RNG.randint(1, 120))

        # Pricing
        daily_rate = RACK_RATES[sipp] * (0.85 if channel == "OTA" else 1.0)
        daily_rate *= RNG.uniform(0.92, 1.12)
        base_total = round(daily_rate * duration, 2)

        # Extras
        extras_snapshot = []
        extras_total = 0.0
        for code, extra_id in EXTRAS.items():
            attach_rates = {"CDW":0.54,"LDW":0.15,"SLI":0.38,"PAI":0.18,"RSA":0.27,"GPS":0.22,"CSS":0.11,"TOLL":0.35,"PPFP":0.31}
            if RNG.random() < attach_rates.get(code, 0.15) and status not in ("CANCELLED","NO_SHOW"):
                daily = EXTRA_DAILY_RATES[code]
                extras_snapshot.append({"extra_id": extra_id, "quantity": 1, "daily_rate": daily})
                extras_total += daily * duration

        taxes_rate = RNG.uniform(0.22, 0.28)
        taxes_total = round((base_total + extras_total) * taxes_rate, 2)
        grand_total = round(base_total + extras_total + taxes_total, 2) if status != "CANCELLED" else None
        taxes_snap = [{"name":"Airport Concession Fee","rate":round(taxes_rate*0.4,4),"amount":round(taxes_total*0.4,2)},
                      {"name":"State Tax","rate":round(taxes_rate*0.35,4),"amount":round(taxes_total*0.35,2)},
                      {"name":"Vehicle License Fee","rate":round(taxes_rate*0.25,4),"amount":round(taxes_total*0.25,2)}]

        # Flight number (30% of airport pickups)
        flight_num = None
        if RNG.random() < 0.30:
            airline = RNG.choice(AIRLINE_PREFIXES)
            flight_num = f"{airline}{RNG.randint(100,4999)}"

        special_instr = None
        if RNG.random() < 0.15:
            special_instr = RNG.choice([
                "Customer requested child seat in trunk",
                "Loyalty platinum — upgrade if available",
                "Corporate account — direct billing",
                "Early morning pickup requested",
                "Wheelchair accessible vehicle preferred",
            ])

        cn = conf_num(pickup_dt)
        while cn in used_conf_nums:
            cn = conf_num(pickup_dt)
        used_conf_nums.add(cn)

        customer_id = RNG.choice(customer_ids)
        rate_code_id = RACK_RATE_CODE_ID

        res_id = uid()
        await conn.execute("""
            INSERT INTO reservations (
                reservation_id, tenant_id, confirmation_number, status,
                customer_id, pickup_location_id, dropoff_location_id,
                pickup_datetime, return_datetime, actual_return_datetime,
                vehicle_class_id, rate_code_id,
                currency, base_rate_daily, base_total, extras_total,
                discount_total, location_fees_total, taxes_total, grand_total,
                deposit_amount, extras_snapshot, taxes_snapshot,
                channel, flight_number, special_instructions,
                loyalty_points_earned, created_at, updated_at
            ) VALUES (
                $1,$2,$3,$4::reservation_status,
                $5,$6,$7,$8,$9,$10,
                $11,$12,
                'USD',$13,$14,$15,
                0,0,$16,$17,
                $18,$19::jsonb,$20::jsonb,
                $21,$22,$23,
                $24,$25,$26
            )
        """, res_id, TENANT_ID, cn, status,
            customer_id, LOC[pickup_loc], LOC[dropoff_loc],
            pickup_dt, return_dt, actual_return_dt,
            class_id, rate_code_id,
            round(daily_rate,2), round(base_total,2), round(extras_total,2),
            round(taxes_total,2), grand_total,
            round(grand_total*0.2,2) if grand_total else 0,
            json.dumps(extras_snapshot), json.dumps(taxes_snap),
            channel, flight_num, special_instr,
            int(grand_total * 10) if grand_total else 0,
            created_at, created_at + timedelta(minutes=5))

        created.append({
            "res_id": res_id, "status": status, "channel": channel,
            "class_id": class_id, "pickup_loc": LOC[pickup_loc],
            "pickup_dt": pickup_dt, "return_dt": return_dt,
            "actual_return_dt": actual_return_dt,
            "grand_total": grand_total, "extras_snapshot": extras_snapshot,
            "customer_id": customer_id, "sipp": sipp, "duration": duration,
            "base_total": base_total, "taxes_total": taxes_total,
            "created_at": created_at,
        })

    return created


# ── Rental agreements + payments ──────────────────────────────────────────────
async def generate_ra_and_payments(conn, reservations, vehicle_by_class, staff_by_loc):
    claims_ras = []  # RAs suitable for damage claims

    # Build a pool of available vehicles per class
    class_vehicle_pool = {}
    for class_id, vlist in vehicle_by_class.items():
        class_vehicle_pool[class_id] = list(vlist)

    assigned_vehicles = set()  # track which are ON_RENT

    for res in reservations:
        if res["status"] not in ("RETURNED", "CHECKED_OUT"):
            continue

        # Find an unassigned vehicle of the right class
        class_id = res["class_id"]
        pool = class_vehicle_pool.get(class_id, [])
        vehicle = None
        for v in pool:
            if v["vehicle_id"] not in assigned_vehicles:
                vehicle = v
                break
        if not vehicle:
            # fallback: grab any available vehicle
            for cid, vlist in class_vehicle_pool.items():
                for v in vlist:
                    if v["vehicle_id"] not in assigned_vehicles:
                        vehicle = v
                        break
                if vehicle:
                    break
        if not vehicle:
            continue

        # Pick agents from the pickup location
        loc_staff = staff_by_loc.get(res["pickup_loc"], [])
        counter_agents = [sid for role, sid in loc_staff if role in ("COUNTER_AGENT","SENIOR_AGENT")]
        if not counter_agents:
            counter_agents = [EXISTING_STAFF["counter@rcm.com"]]

        checkout_agent = RNG.choice(counter_agents)
        checkin_agent  = RNG.choice(counter_agents) if res["status"] == "RETURNED" else None

        odometer_out = RNG.randint(8000, 42000)
        odometer_in  = odometer_out + RNG.randint(50, 800) if res["status"] == "RETURNED" else None
        fuel_out = RNG.randint(85, 100)
        fuel_in  = RNG.randint(20, 100) if res["status"] == "RETURNED" else None

        vin = vehicle.get("vin") or rand_vin("1")
        vin = (vin + " " * 17)[:17]  # pad to exactly 17

        mileage_plan = {"free_miles_per_day": 250, "rental_days": res["duration"], "overage_rate_per_mile": "0.25"}
        rate_snap = {"daily_rate": res["base_total"] / max(res["duration"],1), "currency": "USD"}

        ra_status = "RETURNED" if res["status"] == "RETURNED" else "ACTIVE"
        ra_id = uid()
        ran = ra_num(res["pickup_dt"])

        await conn.execute("""
            INSERT INTO rental_agreements (
                ra_id, tenant_id, ra_number, reservation_id, customer_id,
                checking_out_agent_id, checking_in_agent_id,
                vehicle_id, vin_at_checkout, plate_at_checkout,
                odometer_out, fuel_level_out_pct, odometer_in, fuel_level_in_pct,
                actual_return_datetime, return_location_id,
                rate_snapshot, extras_snapshot, mileage_plan, fuel_policy,
                additional_drivers, status, is_training,
                created_at, updated_at
            ) VALUES (
                $1,$2,$3,$4,$5,
                $6,$7,
                $8,$9,$10,
                $11,$12,$13,$14,
                $15,$16,
                $17::jsonb,$18::jsonb,$19::jsonb,'FULL_TO_FULL',
                '[]'::jsonb,$20,false,
                $21,$22
            )
        """, ra_id, TENANT_ID, ran, res["res_id"], res["customer_id"],
            checkout_agent, checkin_agent,
            vehicle["vehicle_id"], vin, vehicle.get("plate_number") or "",
            odometer_out, fuel_out, odometer_in, fuel_in,
            res["actual_return_dt"], res["pickup_loc"],
            json.dumps(rate_snap), json.dumps(res["extras_snapshot"]),
            json.dumps(mileage_plan),
            ra_status, res["created_at"], NOW)

        # Mark vehicle ON_RENT if still checked out
        if res["status"] == "CHECKED_OUT":
            assigned_vehicles.add(vehicle["vehicle_id"])
            await conn.execute(
                "UPDATE vehicles SET status='ON_RENT' WHERE vehicle_id=$1", vehicle["vehicle_id"]
            )

        # Payments
        grand = res["grand_total"] or 0
        if grand > 0:
            checkout_time = res["pickup_dt"] + timedelta(minutes=15)
            preauth_id = uid()
            await conn.execute("""
                INSERT INTO payments (
                    payment_id, tenant_id, reservation_id, rental_agreement_id,
                    payment_type, status, amount, currency,
                    payment_method, gateway, authorized_at, captured_at, created_at, updated_at
                ) VALUES ($1,$2,$3,$4,'PREAUTH','CAPTURED',$5,'USD','CREDIT_CARD','STRIPE',$6,$6,$6,$6)
            """, preauth_id, TENANT_ID, res["res_id"], ra_id,
                round(grand * 0.2, 2), checkout_time)

            if res["status"] == "RETURNED":
                cap_time = res["actual_return_dt"] or (res["return_dt"] + timedelta(hours=1))
                cap_id = uid()
                await conn.execute("""
                    INSERT INTO payments (
                        payment_id, tenant_id, reservation_id, rental_agreement_id,
                        payment_type, status, amount, currency,
                        payment_method, gateway, authorized_at, captured_at, created_at, updated_at
                    ) VALUES ($1,$2,$3,$4,'CAPTURE','CAPTURED',$5,'USD','CREDIT_CARD','STRIPE',$6,$6,$6,$6)
                """, cap_id, TENANT_ID, res["res_id"], ra_id, round(grand * 0.8, 2), cap_time)

                # 19% chance: extra fuel/damage charge
                if RNG.random() < 0.19:
                    extra_charge = round(RNG.uniform(25, 180), 2)
                    extra_time = cap_time + timedelta(hours=2)
                    await conn.execute("""
                        INSERT INTO payments (
                            payment_id, tenant_id, reservation_id, rental_agreement_id,
                            payment_type, status, amount, currency,
                            payment_method, gateway, authorized_at, captured_at, created_at, updated_at
                        ) VALUES ($1,$2,$3,$4,'INCREMENTAL_AUTH','CAPTURED',$5,'USD','CREDIT_CARD','STRIPE',$6,$6,$6,$6)
                    """, uid(), TENANT_ID, res["res_id"], ra_id, extra_charge, extra_time)

        if res["status"] == "RETURNED":
            claims_ras.append({
                "ra_id": ra_id, "vehicle_id": vehicle["vehicle_id"],
                "customer_id": res["customer_id"],
                "return_dt": res["actual_return_dt"] or res["return_dt"],
                "grand_total": grand,
            })

    return claims_ras


# ── Shift logs ────────────────────────────────────────────────────────────────
async def generate_shift_logs(conn, staff_by_loc):
    for loc_id, staff_list in staff_by_loc.items():
        agents = [sid for role, sid in staff_list if role in ("COUNTER_AGENT","SENIOR_AGENT")]
        if not agents:
            continue
        for agent_id in agents[:4]:  # up to 4 agents per location
            for day_offset in range(90):
                work_date = NOW - timedelta(days=day_offset)
                # 5 out of 7 days worked
                if work_date.weekday() >= 5 and RNG.random() < 0.3:
                    continue
                if RNG.random() < 0.15:
                    continue  # random day off

                shifts = [
                    (6, 0, 14, 0),   # morning
                    (14, 0, 22, 0),  # afternoon
                ]
                shift_times = RNG.choice(shifts)
                shift_start = work_date.replace(hour=shift_times[0], minute=0, second=0, microsecond=0)
                shift_end   = work_date.replace(hour=shift_times[2], minute=shift_times[3], second=0, microsecond=0)
                if shift_end <= shift_start:
                    shift_end += timedelta(days=1)

                cash_open  = round(RNG.uniform(200, 500), 2)
                cash_close = round(cash_open + RNG.uniform(-50, 200), 2)
                txn_count  = RNG.randint(4, 22)

                await conn.execute("""
                    INSERT INTO shift_logs (
                        shift_id, tenant_id, location_id, agent_id,
                        shift_type,
                        opening_cash, closing_cash, expected_cash, cash_variance,
                        fleet_count, pending_pickups_count, notes,
                        created_at
                    ) VALUES ($1,$2,$3,$4,'CLOSE',$5,$6,$7,$8,$9,$10,$11,$12)
                """, uid(), TENANT_ID, loc_id, agent_id,
                    cash_open, cash_close, cash_open, round(cash_close - cash_open, 2),
                    RNG.randint(10,30), txn_count,
                    f"{txn_count} transactions processed. No incidents.",
                    shift_end)


# ── Damage claims ─────────────────────────────────────────────────────────────
async def generate_damage_claims(conn, claims_ras, customer_ids):
    if not claims_ras:
        return

    claims_coordinator = EXISTING_STAFF["claims@rcm.com"]
    used_refs = set()
    selected = RNG.sample(claims_ras, min(30, len(claims_ras)))

    severity_map = {
        "GRADE_1_COSMETIC": (180, 650),
        "GRADE_2_MINOR":    (400, 1500),
        "GRADE_3_MODERATE": (800, 3200),
        "GRADE_4_SEVERE":   (2000, 9000),
        "GRADE_5_TOTAL_LOSS": (8000, 28000),
    }
    sev_options = list(severity_map.keys())
    sev_weights = [48, 25, 14, 10, 3]

    for ra in selected:
        sev = weighted_choice(sev_options, sev_weights)
        cost_range = severity_map[sev]
        cost = round(RNG.uniform(*cost_range), 2)
        disc_type = RNG.choice(DISCOVERY_TYPES)
        claim_type = RNG.choice(CLAIM_TYPES)
        dmg_zone = RNG.choice(DAMAGE_ZONES)
        dmg_type = RNG.choice(DAMAGE_TYPES)
        claim_status = RNG.choice(CLAIM_STATUSES)
        ref = claim_ref(ra["return_dt"])
        while ref in used_refs:
            ref = claim_ref(ra["return_dt"])
        used_refs.add(ref)

        await conn.execute("""
            INSERT INTO damage_claims (
                claim_id, tenant_id, claim_reference,
                rental_agreement_id, vehicle_id, customer_id,
                discovered_by, assigned_to,
                discovered_at, discovery_type,
                damage_zone, damage_type, severity,
                claim_type, status,
                repair_estimate, photos, notes,
                created_at, updated_at
            ) VALUES (
                $1,$2,$3,
                $4,$5,$6,
                $7,$8,
                $9,$10,
                $11,$12,$13::damage_severity,
                $14,$15::claim_status,
                $16,'[]'::jsonb,$17,
                NOW(),NOW()
            )
        """, uid(), TENANT_ID, ref,
            ra["ra_id"], ra["vehicle_id"], ra["customer_id"],
            claims_coordinator, claims_coordinator,
            ra["return_dt"] + timedelta(hours=RNG.randint(1,4)), disc_type,
            dmg_zone, dmg_type, sev,
            claim_type, claim_status,
            cost, f"{sev.replace('_',' ').title()} — {dmg_type.lower()} on {dmg_zone.replace('_',' ').lower()}")


# ── Vehicle blocks ────────────────────────────────────────────────────────────
async def generate_vehicle_blocks(conn, vehicle_rows, staff_by_loc):
    vehicles = [dict(v) for v in vehicle_rows]
    RNG.shuffle(vehicles)
    fleet_mgr = EXISTING_STAFF["fleet@rcm.com"]

    block_count = 0
    for i, vehicle in enumerate(vehicles[:60]):
        block_type = weighted_choice(
            ["MAINTENANCE","INSPECTION","RECALL_HOLD","IN_TRANSIT","HOLD"],
            [40, 25, 10, 15, 10]
        )
        offset = RNG.randint(-5, 25)
        duration_hrs = RNG.randint(4, 72)
        start = NOW + timedelta(days=offset - 2)
        end   = start + timedelta(hours=duration_hrs)
        notes_pool = BLOCK_NOTES_BY_TYPE.get(block_type, ["Routine service"])
        note = RNG.choice(notes_pool)

        await conn.execute("""
            INSERT INTO vehicle_blocks (
                block_id, tenant_id, vehicle_id, block_type,
                start_time, end_time, notes, created_by,
                created_at, updated_at
            ) VALUES ($1,$2,$3,$4::vehicle_block_type,$5,$6,$7,$8,NOW(),NOW())
        """, uid(), TENANT_ID, vehicle["vehicle_id"], block_type,
            start, end, note, fleet_mgr)
        block_count += 1


# ── Promo vehicles ────────────────────────────────────────────────────────────
PROMO_LABELS = [
    "Editor's Pick", "Customer Favorite", "Weekend Deal", "Featured Class",
    "Most Booked", "New to Fleet", "Executive Choice",
]
PROMO_IMAGE_URLS = [
    "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800",
    "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800",
    "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800",
    "https://images.unsplash.com/photo-1542362567-b07e54358753?w=800",
    "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800",
    "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800",
    "https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=800",
    "https://images.unsplash.com/photo-1471479917193-f00955256257?w=800",
]

async def set_promo_vehicles(conn, vehicle_rows):
    available = [v for v in vehicle_rows if v.get("vehicle_class_id") in [
        CLASS["P"], CLASS["L"], CLASS["X"], CLASS["U"]
    ]]
    RNG.shuffle(list(available))
    for i, v in enumerate(available[:8]):
        label = PROMO_LABELS[i % len(PROMO_LABELS)]
        img_url = PROMO_IMAGE_URLS[i % len(PROMO_IMAGE_URLS)]
        await conn.execute("""
            UPDATE vehicles SET promo_label=$1, promo_image_url=$2
            WHERE vehicle_id=$3
        """, label, img_url, v["vehicle_id"])


if __name__ == "__main__":
    asyncio.run(main())
