/**
 * Admin Middleware
 * Checks if the authenticated user has admin privileges and specific permissions
 */

/**
 * Check if user is an admin (basic check)
 */
export const isAdmin = (req, res, next) => {
  try {
    const user = req.customer || req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Check if user is admin
    if (!user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }

    next();
  } catch (error) {
    console.error('[Admin Middleware] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authorization',
    });
  }
};

/**
 * Check if user has permission to access form builder
 */
export const hasFormBuilderPermission = (req, res, next) => {
  try {
    const user = req.customer || req.user;

    // Super admin bypasses permission checks
    if (user?.email === 'forus@gmail.com') {
      return next();
    }

    if (!user?.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }

    if (!user?.adminPermissions?.formBuilder) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Form builder permission required.',
      });
    }

    next();
  } catch (error) {
    console.error('[FormBuilder Permission] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authorization',
    });
  }
};

/**
 * Check if user has permission to access dashboard
 */
export const hasDashboardPermission = (req, res, next) => {
  try {
    const user = req.customer || req.user;

    // Super admin bypasses permission checks
    if (user?.email === 'forus@gmail.com') {
      return next();
    }

    if (!user?.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }

    if (!user?.adminPermissions?.dashboard) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Dashboard permission required.',
      });
    }

    next();
  } catch (error) {
    console.error('[Dashboard Permission] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authorization',
    });
  }
};

/**
 * Check if user has permission to access vendor approval
 */
export const hasVendorApprovalPermission = (req, res, next) => {
  try {
    const user = req.customer || req.user;

    // Super admin bypasses permission checks
    if (user?.email === 'forus@gmail.com') {
      return next();
    }

    if (!user?.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }

    if (!user?.adminPermissions?.vendorApproval) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Vendor approval permission required.',
      });
    }

    next();
  } catch (error) {
    console.error('[VendorApproval Permission] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authorization',
    });
  }
};

/**
 * Check if user has permission to access user management
 */
export const hasUserManagementPermission = (req, res, next) => {
  try {
    const user = req.customer || req.user;

    // Super admin bypasses permission checks
    if (user?.email === 'forus@gmail.com') {
      return next();
    }

    if (!user?.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }

    if (!user?.adminPermissions?.userManagement) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User management permission required.',
      });
    }

    next();
  } catch (error) {
    console.error('[UserManagement Permission] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authorization',
    });
  }
};
