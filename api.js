const express = require('express');
const router = express.Router();
const { checkDatabase } = require('../data/leadStore');

router.get('/health', (req, res) => {
  try {
    checkDatabase();
    return res.json({
      success: true,
      data: {
        status: 'ok',
        service: 'vashodiya-labs',
        database: 'ok',
      },
    });
  } catch (error) {
    console.error('[HEALTH CHECK FAILED]: database unavailable:', error.message);
    return res.status(503).json({
      success: false,
      data: {
        status: 'unavailable',
        service: 'vashodiya-labs',
        database: 'unavailable',
      },
    });
  }
});

module.exports = router;
