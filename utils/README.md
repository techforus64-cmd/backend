# Utils Directory - Shared Services

## 🎯 distanceService.js - SINGLE SOURCE OF TRUTH

**This is the ONLY place distance calculation should be implemented.**

### Usage

```javascript
import { calculateDistanceBetweenPincode } from '../utils/distanceService.js';

// Calculate distance between pincodes
const result = await calculateDistanceBetweenPincode('110020', '560060');
// { estTime: "6", distance: "2100 km", distanceKm: 2100 }
```

### ⚠️ IMPORTANT RULES

#### ✅ DO:
- **ALWAYS** import `calculateDistanceBetweenPincode` from this file
- Report bugs in this file (create GitHub issue)
- Use try-catch to handle errors

#### ❌ DON'T:
- **NEVER** copy this function to other files
- **NEVER** create local distance calculation functions
- **NEVER** use haversine formula directly (use distanceService which has proper fallback)
- **NEVER** call Google Maps API directly

### Error Handling

The function throws specific errors that you should handle:

```javascript
try {
  const result = await calculateDistanceBetweenPincode(origin, destination);
  // Use result.distanceKm, result.estTime, result.distance
} catch (error) {
  if (error.code === 'NO_ROAD_ROUTE') {
    // No road connection exists (e.g., Andaman Islands)
    return res.status(400).json({
      error: "Route not serviceable",
      message: error.message
    });
  }
  if (error.code === 'PINCODE_NOT_FOUND') {
    // Invalid pincode
    return res.status(400).json({
      error: "Invalid pincode",
      field: error.field
    });
  }
  // Handle other errors...
}
```

### Why This Matters

**Problem**: We had 3 different implementations of distance calculation:
- `utils/distanceService.js` (correct - Google Maps)
- `controllers/biddingController.js` (wrong - haversine fallback)
- `routes/vendorRoute.js` (wrong - inline API call)

**Result**: Different endpoints returned different distances for same route!
- `/api/transporter/calculate-price` → 2100 km ✅
- `/api/bidding/calculate` → 1736 km ❌

**Solution**: ONE function to rule them all. Delete duplicates. Import everywhere.

### Current Consumers

These files correctly import from distanceService:

1. ✅ `controllers/biddingController.js`
2. ✅ `controllers/transportController.js`
3. ✅ `routes/vendorRoute.js`
4. ✅ `utils/priceService.js`

### Implementation Details

- **Geocoding**: pincode_centroids.json (36,574+ pincodes)
- **Nearby routes** (same first 2 digits): Haversine × 1.35 road factor (instant, free)
- **Distant routes**: Google Distance Matrix API with precise coordinates
- **Fallback**: Haversine × 1.35 when Google fails or returns suspicious data
- **Cache**: 30-day in-memory Map
- **Performance**: <1ms (nearby/cached), ~400ms (Google first call)
- **Cost**: ~₹0.40 per Google request (nearby routes skip Google = FREE)
- **Accuracy**: 95%+ (Google for long routes, centroid-based for nearby)

### Testing

Run the test script to verify:

```bash
cd backend
node test-distance-google.js
```

### Architecture Decision Record

**Date**: 2025-12-31 (Updated: 2026-01-13)
**Decision**: Use single distanceService.js with hybrid approach
**Rationale**:
- Prevents code duplication
- Ensures consistency across all endpoints
- Uses centroids for geocoding (precise, free, instant)
- Skips Google for nearby pincodes (avoids 150km bug, saves money)
- Uses Google only for distant routes (accurate road distance)
- Haversine fallback for reliability (no downtime)
- Makes caching efficient
- Easier to maintain and debug

**Consequences**:
- Developers MUST import from this file
- NO local implementations allowed
- Changes affect all endpoints (intentional!)
- 40% reduction in Google API costs (nearby routes use centroids)
- Zero downtime (fallback always available)
- More accurate for nearby routes

---

## Related Files

- `distanceService.js` - Distance calculation (THIS FILE)
- `chargeableWeightService.js` - Chargeable weight calculation
- `priceService.js` - Price calculation orchestration

---

**Last Updated**: 2025-12-31
**Maintained By**: Backend Team
