import express from 'express';
import { changePasswordController, forgotPasswordController, getCurrentUser, initiateSignup, loginController, verifyOtpsAndSignup } from '../controllers/authController.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// @route   POST api/auth/signup
// @desc    Register a new customer
// @access  Public
router.post('/signup/initiate', authLimiter, initiateSignup);
router.post('/signup/verify', authLimiter, verifyOtpsAndSignup);
router.post('/login', authLimiter, loginController);
router.post('/forgotpassword', authLimiter, forgotPasswordController);
router.post('/changepassword', authLimiter, changePasswordController);

// @route   GET api/auth/me
// @desc    Get current user with fresh permissions (for page refresh)
// @access  Private (requires auth token)
router.get('/me', protect, getCurrentUser);

export default router;