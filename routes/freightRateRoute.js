import express from 'express';
import { freightRateController } from '../controllers/freightRateController.js';
import { protect } from '../middleware/authMiddleware.js';
import { calculatorRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Calculate freight rate for a single shipment
router.post('/calculate', protect, calculatorRateLimiter, freightRateController.calculateFreightRate);

// Get available options (vehicles, weights, distances)
router.get('/options', freightRateController.getAvailableOptions);

// Get pricing for a specific vehicle and weight
router.get('/vehicle/:vehicle/weight/:weight', freightRateController.getVehiclePricing);

// Calculate freight rates for multiple shipments
router.post('/calculate-multiple', freightRateController.calculateMultipleShipments);

// Get freight rate statistics
router.get('/stats', freightRateController.getFreightRateStats);

export default router;

