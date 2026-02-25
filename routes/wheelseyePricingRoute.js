import express from 'express';
import {
  getWheelseyePricing,
  getAllWheelseyeVehicles,
  getVehiclePricing,
  getAllWheelseyePricing,
  updateWheelseyePricing,
  deleteWheelseyePricing
} from '../controllers/wheelseyePricingController.js';

const router = express.Router();

// Public routes
router.get('/pricing', getWheelseyePricing);
router.get('/vehicles', getAllWheelseyeVehicles);
router.get('/vehicle/:vehicleType', getVehiclePricing);

// Admin routes (you can add authentication middleware here if needed)
router.get('/admin/all', getAllWheelseyePricing);
router.put('/admin/:id', updateWheelseyePricing);
router.delete('/admin/:id', deleteWheelseyePricing);

export default router;

