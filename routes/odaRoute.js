import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  uploadODA,
  getODA,
  getAllODA,
  deleteODA,
} from "../controllers/odaController.js";

const router = express.Router();

// Upload ODA configuration
router.post("/upload", protect, uploadODA);

// Get ODA configuration for specific vendor or customer-level
// Use separate routes for vendor-specific and customer-level
router.get("/get", protect, getODA); // Customer-level (no vendorId)
router.get("/get/:vendorId", protect, getODA); // Vendor-specific

// Get all ODA configurations for customer
router.get("/get-all", protect, getAllODA);

// Delete ODA configuration
router.delete("/delete/:id", protect, deleteODA);

export default router;

