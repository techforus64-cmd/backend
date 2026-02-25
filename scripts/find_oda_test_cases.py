"""
find_oda_test_cases.py
Finds 10 ODA pincodes served by all 4 vendors, computes expected values.

Vendors:
  Shipshopy  - excess ODA: f=500, v=3/kg, threshold=200
  Safexpress - legacy ODA: f=500, v=0
  DB Schenker- switch ODA: f=850, v=4/kg, threshold=212
  VL Cargo   - excess ODA: f=500, v=3/kg, threshold=200 (same as Shipshopy)
"""
import json, openpyxl, os
from collections import defaultdict

EXCEL_PATH    = r'C:\Users\FORUS\Downloads\aeiou (3)\aeiou\Transport Cost Calculator (5).xlsx'
PINCODES_PATH = r'C:\Users\FORUS\Downloads\aeiou (3)\aeiou\backend\data\pincodes.json'
UTSF_DIR      = r'C:\Users\FORUS\Downloads\aeiou (3)\aeiou\backend\data\utsf'

# Load masterPincodes
with open(PINCODES_PATH, 'r', encoding='utf-8') as f:
    pdata = json.load(f)
master = {}
for e in pdata:
    p = e.get('pincode') or e.get('Pincode')
    z = e.get('zone') or e.get('Zone')
    if p and z:
        master[int(p)] = str(z).strip().upper()

wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)

# Load Pincode_B2B_Delhivery — covers Shipshopy, VL Cargo, Safexpress ODA
ws_del = wb['Pincode_B2B_Delhivery']
delhivery_oda = set()
safe_oda = set()
vlc_rates   = {}   # pincode -> {zone, unit_price}
ship_rates  = {}
safe_rates  = {}

for row in ws_del.iter_rows(min_row=2, max_row=ws_del.max_row, values_only=True):
    if row[1] is None: continue
    try: pin = int(row[1])
    except: continue
    zone    = str(row[4]).strip().upper() if row[4] else ''
    oda_raw = str(row[5]).strip().lower() if row[5] else 'no'
    if not zone: continue

    ship_price = row[6]  # col G Shipshopy unit price
    vlc_price  = row[7]  # col H VL Cargo  (18 for all)
    safe_price = row[9]  # col J Safexpress unit price

    if oda_raw == 'yes':
        delhivery_oda.add(pin)
        if safe_price:
            safe_oda.add(pin)

    if ship_price and zone:
        ship_rates[pin]  = {'zone': zone, 'rate': float(ship_price)}
    if vlc_price and zone:
        vlc_rates[pin]   = {'zone': zone, 'rate': float(vlc_price)}
    if safe_price and zone:
        safe_rates[pin]  = {'zone': zone, 'rate': float(safe_price)}

# Load Pincode_DBS — covers DB Schenker
ws_dbs = wb['Pincode_DBS']

# DBS rate table (masterzone-based from analyze_dbs_zones.py findings)
DBS_MASTERZONE_RATES = {
    'N1': 6.0, 'N2': 6.5, 'N3': 6.5, 'N4': 8.1,
    'S1':10.5, 'S2':10.5, 'S3':10.5, 'S4':14.0,
    'E1':10.5, 'E2':11.5, 'W1': 8.1, 'W2': 9.5,
    'C1': 8.6, 'C2': 9.0, 'NE1':20.0,'NE2':20.0,
}

dbs_oda = set()
dbs_served = set()

for row in ws_dbs.iter_rows(min_row=2, max_row=ws_dbs.max_row, values_only=True):
    if row[1] is None: continue
    try: pin = int(row[1])
    except: continue
    oda_raw = str(row[4]).strip().lower() if row[4] else 'no'
    dbs_served.add(pin)
    if oda_raw == 'yes':
        dbs_oda.add(pin)

# Find pincodes ODA for all 4 vendors
all_oda = delhivery_oda & dbs_oda & safe_oda

print(f"Delhivery ODA: {len(delhivery_oda)}")
print(f"Safexpress ODA: {len(safe_oda)}")
print(f"DBS ODA: {len(dbs_oda)}")
print(f"Common ODA (all 4 vendors): {len(all_oda)}")

# ODA calculation functions
def ship_oda(wt): return 500 + max(0, wt - 200) * 3   # excess
def safe_oda_charge(wt): return 500                     # legacy f=500, v=0
def dbs_oda_charge(wt): return 850 if wt <= 212 else 4 * wt  # switch
def vlc_oda_charge(wt): return 500 + max(0, wt - 200) * 3    # excess (same as Shipshopy)

def dbs_total(pin, wt, mz):
    rate = DBS_MASTERZONE_RATES.get(mz)
    if rate is None: return None
    base = wt * rate
    eff  = max(base, 400)
    fuel = 0.05 * base
    docket = 100
    oda = dbs_oda_charge(wt)
    return round(eff + fuel + docket + oda, 2)

def ship_total(pin, wt):
    info = ship_rates.get(pin)
    if not info: return None
    rate = info['rate']
    base = wt * rate
    eff  = max(base, 400)
    # Shipshopy: fuel=0, docket=100
    docket = 100
    oda = ship_oda(wt)
    return round(eff + docket + oda, 2)

def safe_total(pin, wt):
    info = safe_rates.get(pin)
    if not info: return None
    rate = info['rate']
    base = wt * rate
    eff  = max(base, 400)
    fuel = min(0.05 * base, float('inf'))  # Need to check Safexpress fuel
    docket = 350   # Safexpress docket
    oda = safe_oda_charge(wt)
    return round(eff + fuel + docket + oda, 2)

def vlc_total(pin, wt):
    base = wt * 18.0
    oda = vlc_oda_charge(wt)
    return round(base + oda, 2)

# Find 10 good ODA pincodes across different zones
TARGET_WEIGHT = 800

# Group by masterzone
by_zone = defaultdict(list)
for pin in sorted(all_oda):
    mz = master.get(pin)
    if mz and pin in ship_rates and pin in safe_rates:
        by_zone[mz].append(pin)

print("\n=== ODA pincodes by masterzone (common to all 4 vendors) ===")
for mz in sorted(by_zone.keys()):
    print(f"  {mz}: {len(by_zone[mz])} pincodes, first: {by_zone[mz][:3]}")

# Select 1 pincode per zone (prefer ones where we have all data)
selected = []
# Priority zones to cover diverse geography
priority_zones = ['S4', 'W2', 'E2', 'N1', 'S1', 'W1', 'C1', 'E1', 'N3', 'C2',
                  'S2', 'S3', 'N4', 'NE1', 'N2']

for mz in priority_zones:
    if len(selected) >= 10: break
    if by_zone.get(mz):
        pin = by_zone[mz][0]
        selected.append((pin, mz))

# If fewer than 10, fill from other zones
for mz, pins in by_zone.items():
    if len(selected) >= 10: break
    if all(p != pins[0] for p, _ in selected):
        selected.append((pins[0], mz))

print(f"\n=== Selected 10 ODA test pincodes (weight={TARGET_WEIGHT}kg) ===")
print(f"{'Pin':>8} {'mZone':>5} {'DBS_r':>5} {'Ship_r':>6} {'Safe_r':>6}  | DBS_total  Ship_total  Safe_total  VLC_total  | DBS_ODA  Ship_ODA  Safe_ODA  VLC_ODA")
print("-" * 130)

results = []
for pin, mz in selected:
    dbs_r  = DBS_MASTERZONE_RATES.get(mz, None)
    ship_r = ship_rates.get(pin, {}).get('rate')
    safe_r = safe_rates.get(pin, {}).get('rate')

    wt = TARGET_WEIGHT

    # DBS
    if dbs_r:
        dbs_base = wt * dbs_r
        dbs_eff  = max(dbs_base, 400)
        dbs_fuel = 0.05 * dbs_base
        dbs_doc  = 100
        dbs_oda_v = dbs_oda_charge(wt)
        dbs_tot  = round(dbs_eff + dbs_fuel + dbs_doc + dbs_oda_v, 2)
    else:
        dbs_tot = dbs_oda_v = None

    # Shipshopy
    if ship_r:
        ship_base = wt * ship_r
        ship_eff  = max(ship_base, 400)
        ship_oda_v = ship_oda(wt)
        ship_tot  = round(ship_eff + 100 + ship_oda_v, 2)
    else:
        ship_tot = ship_oda_v = None

    # Safexpress
    if safe_r:
        safe_base = wt * safe_r
        safe_eff  = max(safe_base, 400)
        safe_fuel = round(0.05 * safe_base, 2)
        safe_doc  = 350
        safe_oda_v = safe_oda_charge(wt)
        safe_tot  = round(safe_eff + safe_fuel + safe_doc + safe_oda_v, 2)
    else:
        safe_tot = safe_oda_v = None

    # VLC
    vlc_base = wt * 18.0
    vlc_oda_v = vlc_oda_charge(wt)
    vlc_tot  = round(vlc_base + vlc_oda_v, 2)

    print(f"{pin:>8} {mz:>5} {dbs_r or '-':>5} {ship_r or '-':>6} {safe_r or '-':>6}  | {str(dbs_tot):>10} {str(ship_tot):>10} {str(safe_tot):>10} {vlc_tot:>10}  | {str(dbs_oda_v):>7} {str(ship_oda_v):>8} {str(safe_oda_v):>8} {vlc_oda_v:>8}")

    results.append({
        'pin': pin, 'mz': mz, 'weight': wt,
        'dbs':  {'rate': dbs_r,  'oda': dbs_oda_v,  'total': dbs_tot},
        'ship': {'rate': ship_r, 'oda': ship_oda_v, 'total': ship_tot},
        'safe': {'rate': safe_r, 'oda': safe_oda_v, 'total': safe_tot},
        'vlc':  {'rate': 18.0,  'oda': vlc_oda_v,  'total': vlc_tot},
    })

# Generate JS test code
print("\n\n=== JS TEST CODE ===\n")
for i, r in enumerate(results, 1):
    pin = r['pin']
    mz  = r['mz']
    wt  = r['weight']
    print(f"// --- ODA Test {i}: {pin} ({mz}, ODA) {wt}kg ---")
    print(f"// DBS:  base={round(wt*r['dbs']['rate'],2) if r['dbs']['rate'] else '?'}, oda={r['dbs']['oda']}, total={r['dbs']['total']}")
    print(f"// Ship: base={round(wt*r['ship']['rate'],2) if r['ship']['rate'] else '?'}, oda={r['ship']['oda']}, total={r['ship']['total']}")
    print(f"// Safe: base={round(wt*r['safe']['rate'],2) if r['safe']['rate'] else '?'}, oda={r['safe']['oda']}, total={r['safe']['total']}")
    print(f"// VLC:  base={wt*18}, oda={r['vlc']['oda']}, total={r['vlc']['total']}")
    print()

print("Done.")
