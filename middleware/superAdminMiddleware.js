/**
 * Super Admin Middleware
 * Checks if the authenticated user is a super admin
 */
export const isSuperAdmin = (req, res, next) => {
  try {
    const user = req.customer || req.user;
    const email = user?.email;

    // Check if user is super admin
    if (email !== 'forus@gmail.com') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super admin privileges required.',
      });
    }

    next();
  } catch (error) {
    console.error('[SuperAdmin Middleware] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authorization',
    });
  }
};
