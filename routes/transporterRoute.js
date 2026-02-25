// routes/transporterRoutes.js
import express from 'express';
import multer from "multer";

import {
  addTiedUpCompany,
  calculatePrice,
  getAllTransporters,
  getPackingList,
  getTiedUpCompanies,
  getTemporaryTransporters,
  getTemporaryTransporterById,
  updateTemporaryTransporterStatus,
  toggleTemporaryTransporterVerification,
  updateTemporaryTransporter,
  getTransporters,
  getTrasnporterDetails,
  savePckingList,
  deletePackingList,
  removeTiedUpVendor,
  updateVendor,
  getZoneMatrix,
  updateZoneMatrix,
  deleteZoneMatrix,
  saveWizardData,
  getWizardData,
  searchTransporters,  // Quick Lookup search (minimal data)
  getSearchTransporterDetail,  // Quick Lookup detail (full data by ID)
  // Regular transporter verification functions
  getRegularTransporters,
  updateTransporterStatus,
  toggleTransporterVerification,
  // Box Library CRUD
  getBoxLibraries,
  createBoxLibrary,
  updateBoxLibrary,
  deleteBoxLibrary
} from '../controllers/transportController.js';

import {
  addPrice,
  addTransporter,
  downloadTransporterTemplate,
  transporterLogin
} from '../controllers/transporterAuth.js';

import { protect } from '../middleware/authMiddleware.js';
import { hasVendorApprovalPermission } from '../middleware/isAdminMiddleware.js';
import { uploadLimiter, apiLimiter, authLimiter, calculatorRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,      // 10MB for file uploads
    fieldSize: 10 * 1024 * 1024,     // 10MB for JSON fields (serviceability array)
    fields: 100                       // Allow many form fields
  }
});

// Auth / admin endpoints
router.post("/auth/addtransporter", uploadLimiter, upload.single('sheet'), addTransporter);
router.get("/auth/downloadtemplate", downloadTransporterTemplate);
router.post("/auth/addprice", apiLimiter, addPrice);
router.post("/auth/signin", authLimiter, transporterLogin);

// Calculator & add vendor
router.post('/calculate', protect, calculatorRateLimiter, calculatePrice);
router.get('/search-transporters', protect, searchTransporters);  // Fast search - minimal data
router.get('/search-transporters/:id', protect, getSearchTransporterDetail);  // Full detail by ID
router.post("/addtiedupcompanies", protect, upload.single('priceChart'), addTiedUpCompany);
router.post("/add-tied-up", protect, addTiedUpCompany);

// Tied-up & temporary vendors
router.get("/gettiedupcompanies", protect, getTiedUpCompanies);

// DELETE endpoints: support both param-style and legacy body/query style
// New frontend calls DELETE /api/transporter/delete-vendor/:id
router.delete('/delete-vendor/:id', protect, removeTiedUpVendor);
// Older callers may call /remove-tied-up with id in body or query
router.delete("/remove-tied-up", protect, removeTiedUpVendor);

// Temporary transporters aliases (keeps backward compatibility)
router.get('/temporary', protect, (req, res, next) => {
  req.query.customerID = req.query.customerID || req.query.customerId || req.query.customerid;
  return getTemporaryTransporters(req, res, next);
});
router.get("/gettemporarytransporters", protect, getTemporaryTransporters);
router.get("/temporary/:id", protect, getTemporaryTransporterById);  // Get single by ID - must be before PUT routes
router.put("/temporary/:id", protect, updateTemporaryTransporter);
// Vendor approval routes - require vendorApproval permission
router.put("/temporary/:id/status", protect, hasVendorApprovalPermission, updateTemporaryTransporterStatus);
router.put("/temporary/:id/verification", protect, hasVendorApprovalPermission, toggleTemporaryTransporterVerification);

// Regular transporter routes (for admin approval/verification)
// These work with the transporters collection (not temporary transporters)
router.get("/regular", protect, hasVendorApprovalPermission, getRegularTransporters);
router.put("/regular/:id/status", protect, hasVendorApprovalPermission, updateTransporterStatus);
router.put("/regular/:id/verification", protect, hasVendorApprovalPermission, toggleTransporterVerification);

// Transporter listings & details
router.get("/gettransporter", getTransporters);
router.get("/getalltransporter", getAllTransporters);
router.get("/gettransporterdetails/:id", getTrasnporterDetails);

// Packing list endpoints
router.post("/savepackinglist", protect, savePckingList);
router.get("/getpackinglist", protect, getPackingList);
router.delete('/deletepackinglist/:id', protect, deletePackingList);

// Vendor update
router.put('/update-vendor/:id', protect, updateVendor);

// Zone Matrix CRUD endpoints
router.get('/zone-matrix/:vendorId', protect, getZoneMatrix);
router.put('/zone-matrix/:vendorId', protect, updateZoneMatrix);
router.delete('/zone-matrix/:vendorId', protect, deleteZoneMatrix);

// Wizard Data Sync endpoints
router.post('/wizard-data', protect, saveWizardData);
router.get('/wizard-data', protect, getWizardData);

// Box Library CRUD endpoints (sync across devices)
router.get('/box-libraries', protect, getBoxLibraries);
router.post('/box-libraries', protect, createBoxLibrary);
router.put('/box-libraries/:id', protect, updateBoxLibrary);
router.delete('/box-libraries/:id', protect, deleteBoxLibrary);

export default router;
