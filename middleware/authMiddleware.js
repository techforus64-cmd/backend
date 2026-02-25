// middleware/authMiddleware.js
import jwt from 'jsonwebtoken';
import customerModel from '../model/customerModel.js';

export const protect = async (req, res, next) => {
  let token;

  // 1️⃣ Try Authorization header: "Bearer <token>"
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 2️⃣ If no token yet, try cookies: authToken=<token>
  if (!token) {
    // If you use cookie-parser, this will work:
    if (req.cookies && req.cookies.authToken) {
      token = req.cookies.authToken;
    } else if (req.headers.cookie) {
      // Manual parse in case cookie-parser isn't used
      const rawCookie = req.headers.cookie; // "authToken=xxx; otherCookie=yyy"
      const parts = rawCookie.split(';').map((c) => c.trim());
      for (const part of parts) {
        const [name, ...rest] = part.split('=');
        if (name === 'authToken') {
          token = rest.join('=');
          break;
        }
      }
    }
  }

  // 3️⃣ If still no token → 401
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided',
    });
  }

  try {
    // Get JWT_SECRET at runtime
    const JWT_SECRET = process.env.JWT_SECRET;

    if (
      !JWT_SECRET ||
      JWT_SECRET ===
      'your_jwt_secret_key_change_this_to_a_secure_random_string_minimum_32_characters'
    ) {
      console.error('FATAL ERROR: JWT_SECRET is not properly configured.');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error: JWT_SECRET not set',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.customer || !decoded.customer._id) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, invalid token structure',
      });
    }

    const customer = await customerModel
      .findById(decoded.customer._id)
      .select('-password');

    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, user not found',
      });
    }

    // Single-session enforcement: compare JWT sessionVersion with DB sessionVersion
    // Guard: only enforce if the JWT actually contains sessionVersion (backward compatible)
    if (
      decoded.customer.sessionVersion !== undefined &&
      decoded.customer.sessionVersion !== customer.sessionVersion
    ) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. You have been logged in on another device.',
        code: 'SESSION_REPLACED',
      });
    }

    // Backward + new-code compatible
    req.customer = customer;
    req.user = customer; // so /api/users/me using req.user works

    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token is invalid',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token has expired',
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Not authorized, token processing failed',
    });
  }
};
