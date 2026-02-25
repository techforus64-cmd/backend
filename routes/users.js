// routes/users.js 
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * GET /api/users/me
 * Return the currently authenticated customer's data.
 */
router.get('/me', protect, async (req, res) => {
  try {
    const user = req.user || req.customer; // set in protect()

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized',
      });
    }

    const safeUser = user.toObject ? user.toObject() : user;

    // strip sensitive stuff
    delete safeUser.password;
    delete safeUser.__v;

    // NOTE: createdAt / updatedAt (timestamps) are kept as-is
    return res.json({
      success: true,
      data: safeUser,
    });
  } catch (err) {
    console.error('Error in /api/users/me:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

export default router;
