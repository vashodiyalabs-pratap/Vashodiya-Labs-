const express = require('express');
const router = express.Router();
const {
  listLeads,
  getStats,
  findLeadById,
  listFollowUpNotes,
  addFollowUpNote,
  updateLeadStatus,
  validStatuses,
} = require('../data/leadStore');

router.get('/summary', (req, res) => {
  return res.json({
    success: true,
    data: getStats(),
  });
});

router.get('/leads', (req, res) => {
  const status = req.query.status;
  if (status && !validStatuses.includes(String(status).toLowerCase())) {
    return res.status(400).json({
      success: false,
      message: 'Status must be one of: ' + validStatuses.join(', '),
    });
  }

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search.length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Search must be 100 characters or fewer.',
    });
  }

  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 25);
  const offset = (page - 1) * limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Page must be a positive integer and limit must be between 1 and 100.',
    });
  }

  const leads = listLeads({
    status,
    search,
    limit,
    offset,
  });
  return res.json({
    success: true,
    data: {
      total: leads.total,
      items: leads.items,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(leads.total / limit),
      },
    },
  });
});

router.get('/leads/:identifier', (req, res) => {
  const lead = findLeadById(req.params.identifier);

  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found.',
    });
  }

  return res.json({
    success: true,
    data: lead,
  });
});

router.get('/leads/:identifier/notes', (req, res) => {
  if (!findLeadById(req.params.identifier)) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found.',
    });
  }

  return res.json({
    success: true,
    data: listFollowUpNotes(req.params.identifier),
  });
});

router.post('/leads/:identifier/notes', (req, res) => {
  if (!findLeadById(req.params.identifier)) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found.',
    });
  }

  const note = req.body?.note;
  if (typeof note !== 'string' || !note.trim() || note.trim().length > 2000) {
    return res.status(400).json({
      success: false,
      message: 'Note must be text between 1 and 2,000 characters.',
    });
  }

  const savedNote = addFollowUpNote(req.params.identifier, note.trim());
  return res.status(201).json({
    success: true,
    data: savedNote,
  });
});

router.patch('/leads/:identifier/status', (req, res) => {
  const nextStatus = String(req.body?.status || req.body?.newStatus || '').trim();

  if (!nextStatus) {
    return res.status(400).json({
      success: false,
      message: 'A valid status is required.',
    });
  }

  const isValidStatus = validStatuses.includes(nextStatus.toLowerCase());
  if (!isValidStatus) {
    return res.status(400).json({
      success: false,
      message: 'Status must be one of: ' + validStatuses.join(', '),
    });
  }

  const lead = updateLeadStatus(req.params.identifier, nextStatus);
  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found.',
    });
  }

  return res.json({
    success: true,
    message: 'Lead status updated successfully.',
    data: lead,
  });
});

module.exports = router;
