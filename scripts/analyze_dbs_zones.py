"""
analyze_dbs_zones.py
Analyzes how DBS zones map to masterPincodes zones.
"""
import json, openpyxl, os
from collections import defaultdict, Counter

EXCEL_PATH = r'C:\Users\FORUS\Downloads\aeiou (3)\aeiou\Transport Cost Calculator (5).xlsx'
PINCODES_PATH = r'C:\Users\FORUS\Downloads\aeiou (3)\aeiou\backend\data\pincodes.json'

# Load masterPincodes
print("Loading pincodes.json...")
with open(PINCODES_PATH, 'r', encoding='utf-8') as f:
    pincodes_data = json.load(f)

master = {}
for entry in pincodes_data:
    pin = entry.get('pincode') or entry.get('Pincode')
    zone = entry.get('zone') or entry.get('Zone')
    if pin and zone:
        master[int(pin)] = str(zone).strip().upper()

print(f"Loaded {len(master)} master pincodes")
print(f"Sample: 226010={master.get(226010,'?')}, 689703={master.get(689703,'?')}, 110020={master.get(110020,'?')}")

# Load Pincode_DBS
print("\nReading Pincode_DBS sheet...")
wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb['Pincode_DBS']

# Read rate table
rate_table = {}
for row in ws.iter_rows(min_row=2, max_row=20, values_only=True):
    if row[8] is not None and row[9] is not None:
        zname = str(row[8]).strip()
        rval = float(row[9])
        if zname and zname != 'Zone':
            rate_table[zname] = rval
print(f"DBS Rate table: {rate_table}")

# Cross-reference DBS zones with masterPincodes zones
# dbs_zone -> [master_zone counts]
dbs_to_master = defaultdict(list)  # dbs_zone -> list of master zones
master_to_dbs_rate = defaultdict(list)  # master_zone -> list of (dbs_zone, rate)
not_in_master = defaultdict(int)  # dbs_zone -> count of pincodes not in master

all_dbs_pincodes = {}  # pincode -> {zone, oda, master_zone}

for row in ws.iter_rows(min_row=2, max_row=ws.max_row, values_only=True):
    if row[1] is None or row[5] is None:
        continue
    try:
        pin = int(row[1])
    except:
        continue
    dbs_zone = str(row[5]).strip()
    if not dbs_zone:
        continue
    oda_raw = str(row[4]).strip() if row[4] is not None else 'No'
    is_oda = oda_raw.lower() == 'yes'

    master_zone = master.get(pin)
    if master_zone:
        dbs_to_master[dbs_zone].append(master_zone)
        rate = rate_table.get(dbs_zone, None)
        if rate:
            master_to_dbs_rate[master_zone].append((dbs_zone, rate))
    else:
        not_in_master[dbs_zone] += 1

    all_dbs_pincodes[pin] = {'dbs_zone': dbs_zone, 'oda': is_oda, 'master_zone': master_zone}

print("\n=== DBS Zone -> MasterPincodes Zone Mapping ===")
for dbs_zone in sorted(dbs_to_master.keys()):
    zones = dbs_to_master[dbs_zone]
    counter = Counter(zones)
    total = len(zones)
    dominant = counter.most_common(3)
    rate = rate_table.get(dbs_zone, '?')
    print(f"  DBS {dbs_zone} (rate={rate}/kg, {total} pincodes in master):")
    for mz, cnt in dominant:
        print(f"    master {mz}: {cnt} ({cnt*100//total}%)")
    if not_in_master.get(dbs_zone, 0):
        print(f"    NOT IN MASTER: {not_in_master[dbs_zone]}")

print("\n=== MasterPincodes Zone -> Dominant DBS Rate ===")
for mz in sorted(master_to_dbs_rate.keys()):
    entries = master_to_dbs_rate[mz]
    rate_counter = Counter(r for _, r in entries)
    dbs_zone_counter = Counter(dz for dz, _ in entries)
    dominant_rate = rate_counter.most_common(1)[0]
    dominant_dbs_zone = dbs_zone_counter.most_common(1)[0]
    print(f"  master {mz}: dominant_dbs_zone={dominant_dbs_zone[0]} (rate={rate_table.get(dominant_dbs_zone[0],'?')}), {len(entries)} pincodes")

print("\n=== Key pincodes ===")
for pin in [110020, 110001, 226010, 689703, 400001, 302001, 500001, 600001]:
    info = all_dbs_pincodes.get(pin, None)
    master_z = master.get(pin, '?')
    if info:
        print(f"  {pin}: DBS={info['dbs_zone']}, master={info['master_zone']}, ODA={info['oda']}")
    else:
        print(f"  {pin}: NOT IN DBS, master={master_z}")

# Find good test pincodes: non-ODA, in DBS, masterzone=DBS zone
print("\n=== Good DBS test pincodes (DBS zone == master zone, non-ODA) ===")
for dbs_zone in ['N1', 'S1', 'W1', 'C1', 'E1']:
    found = []
    for pin, info in all_dbs_pincodes.items():
        if info['dbs_zone'] == dbs_zone and not info['oda'] and info['master_zone'] == dbs_zone:
            found.append(pin)
    found.sort()
    print(f"  DBS/master {dbs_zone}: {found[:5]} ({'...' if len(found)>5 else ''}total {len(found)})")

# Find good ODA test pincodes for DBS
print("\n=== ODA pincodes where DBS zone == master zone ===")
for dbs_zone in ['N1', 'S1', 'W1', 'C1']:
    found = []
    for pin, info in all_dbs_pincodes.items():
        if info['dbs_zone'] == dbs_zone and info['oda'] and info['master_zone'] == dbs_zone:
            found.append(pin)
    found.sort()
    print(f"  DBS/master {dbs_zone} ODA: {found[:5]} (total {len(found)})")

print("\nDone.")
