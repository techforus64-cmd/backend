"""
fix_dbs_utsf.py
Two-step fix for DB Schenker UTSF:
  1. Correct zoneRates["N1"] to match exact values from Pincode_DBS rate table
  2. Rebuild zoneOverrides: for every DBS pincode where DBS-internal zone != master zone,
     write an explicit override so rate lookup uses the right DBS zone.
     Pincodes where DBS zone == master zone get no override (redundant).
"""
import json, os, copy

BASE  = os.path.join(os.path.dirname(__file__), '..', '..')
UTSF  = os.path.join(BASE, 'backend', 'data', 'utsf',
                     '67b4b800db5c000000000001.utsf.json')
LOOK  = os.path.join(BASE, 'backend', 'scripts', 'excel_lookup.json')
PINS  = os.path.join(BASE, 'backend', 'data', 'pincodes.json')

# ── Load data ────────────────────────────────────────────────────────────────
print("Loading files...")
with open(UTSF, 'r') as f:
    utsf = json.load(f)

with open(LOOK, 'r') as f:
    lookup = json.load(f)

with open(PINS, 'r') as f:
    pins_raw = json.load(f)

# Build master pincode -> zone map
master = {}
for e in pins_raw:
    pin  = e.get('pincode') or e.get('Pincode')
    zone = e.get('zone')    or e.get('Zone')
    if pin and zone:
        master[int(pin)] = str(zone).strip().upper()

dbs_map   = lookup['dbs']       # str(pin) -> {zone, oda}
dbs_rates = lookup['dbs_rates'] # zone -> rate

print(f"  Master pincodes: {len(master)}")
print(f"  DBS pincodes from Excel: {len(dbs_map)}")
print(f"  DBS rates from Excel: {dbs_rates}")

# ── Step 1: Fix zoneRates["N1"] ──────────────────────────────────────────────
# Correct values come from dbs_rates (exactly as extracted from Pincode_DBS).
# zoneRates["N1"] must map every DBS-internal zone to its rate FROM N1 (origin).
# Since DBS uses a flat rate table (same rate regardless of origin zone within
# India), we just use the dbs_rates directly.

OLD_RATES = utsf['pricing']['zoneRates']['N1']
NEW_RATES = {zone: rate for zone, rate in dbs_rates.items()}

print("\nStep 1 — Fixing zoneRates['N1']:")
for zone in sorted(set(list(OLD_RATES.keys()) + list(NEW_RATES.keys()))):
    old_v = OLD_RATES.get(zone)
    new_v = NEW_RATES.get(zone)
    status = "OK" if old_v == new_v else "CHANGED"
    print(f"  {zone}: {old_v} -> {new_v}  [{status}]")

utsf['pricing']['zoneRates']['N1'] = NEW_RATES

# ── Step 2: Rebuild zoneOverrides ────────────────────────────────────────────
# Only add an override when DBS internal zone differs from master zone.
# This ensures DBS-specific zone assignments (N2, N3, etc.) are preserved
# while keeping the file clean (no redundant N1->N1 overrides).

new_overrides = {}
overrides_added   = 0
overrides_skipped = 0
master_missing    = 0

for pin_str, row in dbs_map.items():
    dbs_zone = row['zone'].strip().upper()
    pin_int  = int(pin_str)
    mzone    = master.get(pin_int)

    if mzone is None:
        # Not in master → still add override so UTSF knows which rate to use
        new_overrides[pin_str] = dbs_zone
        master_missing += 1
        overrides_added += 1
    elif dbs_zone != mzone:
        # DBS zone differs from master zone → explicit override needed
        new_overrides[pin_str] = dbs_zone
        overrides_added += 1
    else:
        # Same zone → no override needed
        overrides_skipped += 1

print(f"\nStep 2 — Rebuilt zoneOverrides:")
print(f"  Overrides added   : {overrides_added}")
print(f"  Skipped (same zone): {overrides_skipped}")
print(f"  Master missing     : {master_missing}")
print(f"  Old override count : {len(utsf.get('zoneOverrides', {}))}")

# Spot-check known problematic pins
for check_pin in ['110001', '110002', '110003', '233229', '180003', '670001']:
    old_v = utsf.get('zoneOverrides', {}).get(check_pin, '(none)')
    new_v = new_overrides.get(check_pin, '(none)')
    mz    = master.get(int(check_pin), 'N/A')
    dz    = dbs_map.get(check_pin, {}).get('zone', 'N/A')
    print(f"  pin {check_pin}: master={mz} dbs={dz} | old_override={old_v} -> new_override={new_v}")

utsf['zoneOverrides'] = new_overrides

# ── Step 3: Update metadata ──────────────────────────────────────────────────
import datetime
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
utsf['meta']['updatedAt'] = ts
if 'updates' not in utsf:
    utsf['updates'] = []
utsf['updates'].append({
    "date": ts,
    "by": "fix_dbs_utsf.py",
    "changes": f"Fixed zoneRates N2/N3/S3; rebuilt {overrides_added} zoneOverrides from Pincode_DBS",
    "scope": "zoneRates+zoneOverrides"
})

# ── Write back ───────────────────────────────────────────────────────────────
print(f"\nWriting fixed UTSF -> {UTSF}")
with open(UTSF, 'w') as f:
    json.dump(utsf, f, indent=2)

print("Done.")
