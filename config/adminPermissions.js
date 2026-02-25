/**
 * Admin Permissions Configuration
 *
 * This is the single source of truth for all admin permissions on the backend.
 * When adding a new permission:
 * 1. Add the permission key to this file
 * 2. Update the customer model schema
 * 3. Create a middleware function in isAdminMiddleware.js
 * 4. Update the frontend config/adminPermissions.ts
 */

// All available permission keys
export const PERMISSION_KEYS = [
  'formBuilder',
  'dashboard',
  'vendorApproval',
  'userManagement',
  // Future permissions can be added here:
  // 'analytics',
  // 'billing',
  // 'reports',
];

// Default permissions for new admins
export const DEFAULT_ADMIN_PERMISSIONS = {
  formBuilder: true,    // Default permission for new admins
  dashboard: false,
  vendorApproval: false,
  userManagement: false,
};

// Permission descriptions (for documentation/UI)
export const PERMISSION_DESCRIPTIONS = {
  formBuilder: 'Access to Platform Config Form Builder',
  dashboard: 'Access to Analytics Dashboard',
  vendorApproval: 'Access to Vendor Approval page',
  userManagement: 'Access to User Management pages',
};

/**
 * Validate permissions object
 * Ensures all permission keys exist and are boolean
 */
export const validatePermissions = (permissions) => {
  if (!permissions || typeof permissions !== 'object') {
    return DEFAULT_ADMIN_PERMISSIONS;
  }

  const validated = {};
  for (const key of PERMISSION_KEYS) {
    validated[key] = permissions[key] === true;
  }
  return validated;
};

/**
 * Check if user has a specific permission
 * Super admin always returns true
 */
export const hasPermission = (user, permission) => {
  if (!user) return false;

  // Super admin always has all permissions
  if (user.email === 'forus@gmail.com') return true;

  // Check if user is admin
  if (!user.isAdmin) return false;

  // Check specific permission
  return user.adminPermissions?.[permission] === true;
};
