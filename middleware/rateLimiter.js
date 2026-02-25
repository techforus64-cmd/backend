import rateLimit from "express-rate-limit";
import redisClient from "../utils/redisClient.js";

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

/**
 * Strict rate limiter for authentication endpoints
 * More lenient in development, stricter in production
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 5 : 1000, // 5 in production, 1000 in development
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  // In development, disable rate limiting completely for localhost
  skip: (req) => {
    // Completely skip rate limiting in development mode
    if (process.env.NODE_ENV !== "production") {
      return true; // Skip all rate limiting in development
    }
    return false;
  },
});

/**
 * Rate limiter for file upload endpoints
 * 10 requests per hour per IP
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 uploads per hour
  message: {
    success: false,
    message: "Too many file uploads, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/* =========================================================================
   Calculator Rate Limiter — 15 searches / hour / authenticated user
   Uses Redis INCR + EXPIRE (sliding window counter pattern).
   Must be placed AFTER the `protect` auth middleware so req.customer exists.
   ========================================================================= */

const CALC_RATE_LIMIT = 15;       // max calculations per window
const CALC_WINDOW_SECONDS = 3600; // 1 hour

export const calculatorRateLimiter = async (req, res, next) => {
  // 1. Skip in development mode (same pattern as authLimiter)
  if (process.env.NODE_ENV !== "production") {
    return next();
  }

  // 2. Bypass for admin, subscribed, super admin, and explicitly exempted users
  const SUPER_ADMIN_EMAIL = 'forus@gmail.com';
  if (
    req.customer?.isAdmin ||
    req.customer?.isSubscribed ||
    req.customer?.rateLimitExempt ||
    req.customer?.email?.toLowerCase() === SUPER_ADMIN_EMAIL
  ) {
    console.log(`[RateLimit] BYPASSED for ${req.customer?.email} — isAdmin:${req.customer?.isAdmin} isSubscribed:${req.customer?.isSubscribed} exempt:${req.customer?.rateLimitExempt} isSuperAdmin:${req.customer?.email?.toLowerCase() === SUPER_ADMIN_EMAIL}`);
    return next();
  }

  // 3. Require authenticated user (protect middleware sets req.customer)
  const userId = req.customer?._id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required for calculator.",
    });
  }

  const redisKey = `calc_limit:${userId}`;
  const userMaxRequests = req.customer.customRateLimit || CALC_RATE_LIMIT; // Read dynamic limit
  console.log(`[RateLimit] User: ${req.customer?.email}, customRateLimit: ${req.customer?.customRateLimit}, effective max: ${userMaxRequests}`);

  try {
    // Atomic increment — returns the NEW count after increment
    const currentCount = await redisClient.incr(redisKey);

    // First request in this window — set the 1-hour expiry
    if (currentCount === 1) {
      await redisClient.expire(redisKey, CALC_WINDOW_SECONDS);
    }

    // Get TTL for headers / retry info
    const ttl = await redisClient.ttl(redisKey);
    const remaining = Math.max(0, userMaxRequests - currentCount);

    // Set standard rate-limit headers on every response
    res.set("X-RateLimit-Limit", String(userMaxRequests));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset", String(ttl > 0 ? ttl : CALC_WINDOW_SECONDS));

    // 4. Rate limit check (dynamic max)
    if (currentCount > userMaxRequests) {
      console.log(`[RateLimit] User ${userId} exceeded ${userMaxRequests} calc/hr (count: ${currentCount})`);
      return res.status(429).json({
        success: false,
        message: `Rate limit reached. Maximum ${userMaxRequests} calculations per hour.`,
        retryAfterSeconds: ttl,
        remainingSearches: 0,
      });
    }

    // 5. CAPTCHA Check (Every 5 searches: 5, 10, 15)
    if (currentCount > 0 && currentCount % 5 === 0) {
      const captchaToken = req.headers['x-captcha-token'];

      if (!captchaToken) {
        // Decrement the counter so they don't consume their limit just by missing the token
        await redisClient.decr(redisKey);

        return res.status(428).json({
          success: false,
          message: 'Security challenge required. Please complete the CAPTCHA.',
          requireCaptcha: true,
          remainingSearches: userMaxRequests - (currentCount - 1),
        });
      }

      // Verify CAPTCHA token with Google
      // Use real key from env, or fall back to Google's test secret key (always passes)
      const secretKey = process.env.RECAPTCHA_SECRET_KEY || '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';
      if (!secretKey) {
        console.error('[CAPTCHA] Missing RECAPTCHA_SECRET_KEY in backend .env');
      } else {
        try {
          const verifyResponse = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${secretKey}&response=${captchaToken}`,
          });
          const verifyData = await verifyResponse.json();

          if (!verifyData.success) {
            // Decrement counter as well so they can try again
            await redisClient.decr(redisKey);
            return res.status(400).json({
              success: false,
              message: 'Invalid or expired CAPTCHA. Please try again.',
            });
          }
        } catch (captchaErr) {
          console.error('[CAPTCHA] Verification error:', captchaErr.message);
          // Allow to pass if Google API crashes to prevent locking users out
        }
      }
    }

    next();
  } catch (err) {
    // Redis is down — degrade gracefully, let the request through
    console.error("[RateLimit] Redis error (allowing request):", err.message);
    next();
  }
};
