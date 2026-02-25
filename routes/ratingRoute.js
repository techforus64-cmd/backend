/**
 * Rating Routes
 *
 * API endpoints for vendor rating submission and retrieval.
 */

import express from "express";
import {
  submitRating,
  getVendorRatings,
  getVendorRatingSummary,
} from "../controllers/ratingController.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// Submit a new rating for a vendor
// POST /api/ratings/submit
router.post("/submit", apiLimiter, submitRating);

// Get all ratings for a vendor (paginated)
// GET /api/ratings/vendor/:vendorId?isTemporary=true&page=1&limit=10
router.get("/vendor/:vendorId", apiLimiter, getVendorRatings);

// Get rating summary for a vendor (aggregated averages)
// GET /api/ratings/summary/:vendorId?isTemporary=true
router.get("/summary/:vendorId", apiLimiter, getVendorRatingSummary);

export default router;
