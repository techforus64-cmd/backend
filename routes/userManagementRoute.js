import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { isSuperAdmin } from '../middleware/superAdminMiddleware.js';
import {
  hasDashboardPermission,
  hasUserManagementPermission,
} from '../middleware/isAdminMiddleware.js';
import {
  getAllCustomers,
  getCustomerById,
  updateCustomerSubscription,
  updateCustomerRateLimitExempt,
  updateCustomerCustomRateLimit,
  updateCustomer,
  deleteCustomer,
  getAllTransporters,
  getPlatformStats,
  getAllUsersForAdminManagement,
  approveUserAsAdmin,
  revokeAdminAccess,
  updateAdminPermissions,
} from '../controllers/userManagementController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Platform statistics - requires dashboard permission
router.get('/stats', hasDashboardPermission, getPlatformStats);

// Customer management routes - requires userManagement permission
router.get('/customers', hasUserManagementPermission, getAllCustomers);
router.get('/customers/:id', hasUserManagementPermission, getCustomerById);
router.put('/customers/:id/subscription', hasUserManagementPermission, updateCustomerSubscription);
router.put('/customers/:id/rate-limit-exempt', hasUserManagementPermission, updateCustomerRateLimitExempt);
router.put('/customers/:id/custom-rate-limit', hasUserManagementPermission, updateCustomerCustomRateLimit);
router.put('/customers/:id', hasUserManagementPermission, updateCustomer);
router.delete('/customers/:id', hasUserManagementPermission, deleteCustomer);

// Transporter management routes - requires userManagement permission
router.get('/transporters', hasUserManagementPermission, getAllTransporters);

// Admin management routes - SUPER ADMIN ONLY
router.get('/admins', isSuperAdmin, getAllUsersForAdminManagement);
router.put('/admins/:id/approve', isSuperAdmin, approveUserAsAdmin);
router.put('/admins/:id/revoke', isSuperAdmin, revokeAdminAccess);
router.put('/admins/:id/permissions', isSuperAdmin, updateAdminPermissions);

export default router;
