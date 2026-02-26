import express from 'express';
import {
    getIndiaPostPricing,
    getAllIndiaPostPricing,
    addIndiaPostPricing,
    updateIndiaPostPricing,
    deleteIndiaPostPricing
} from '../controllers/indiaPostPricingController.js';

const router = express.Router();

// Public routes (if needed to call directly via GET)
router.get('/pricing', getIndiaPostPricing);

// Admin routes
router.get('/admin/all', getAllIndiaPostPricing);
router.post('/admin/add', addIndiaPostPricing);
router.put('/admin/:id', updateIndiaPostPricing);
router.delete('/admin/:id', deleteIndiaPostPricing);

export default router;
