// routes/dashboard.js
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * GET /api/dashboard/overview
 *
 * For now this just returns zeroed metrics for the
 * currently authenticated customer. The frontend
 * already handles this by showing the "No activity yet"
 * empty state when totalShipments === 0.
 *
 * Later you can replace the TODO section with real
 * aggregation from your shipments/booking collection.
 */
router.get('/overview', protect, async (req, res) => {
  try {
    // const customerId = req.customer?._id || req.user?._id;
    // TODO: when you have a Shipment/Booking model,
    // query it here and compute real metrics.

    return res.json({
      success: true,
      data: {
        totalShipments: 0,
        totalSpend: 0,
        avgCostPerShipment: 0,
        totalSavings: 0,
        sampleCount: 0,
      },
    });
  } catch (err) {
    console.error('Error in /api/dashboard/overview:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to compute dashboard overview',
    });
  }
});

export default router;
