const { timingSafeEqual } = require('node:crypto');
const rateLimit = require('express-rate-limit');

const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many unsuccessful admin sign-in attempts. Please try again in 15 minutes.',
  },
});

const requireAdminKey = (req, res, next) => {
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey || configuredKey.length < 32) {
    return res.status(503).json({
      success: false,
      message:
        'Admin API is unavailable until ADMIN_API_KEY is configured with at least 32 characters.',
    });
  }

  const [scheme, providedKey, ...extraParts] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !providedKey || extraParts.length > 0) {
    return res.status(401).json({
      success: false,
      message: 'A valid bearer token is required.',
    });
  }

  const expected = Buffer.from(configuredKey);
  const provided = Buffer.from(providedKey);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return res.status(401).json({
      success: false,
      message: 'A valid bearer token is required.',
    });
  }

  return next();
};

module.exports = { adminAuthLimiter, requireAdminKey };
