const rateLimit = require('express-rate-limit');

// Prevent form spam by limiting requests to 5 per IP every 15 minutes
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again after 15 minutes.',
  },
});

module.exports = { contactLimiter };
