const express = require('express');
const { randomUUID } = require('node:crypto');
const router = express.Router();
const { contactLimiter } = require('../middleware/rateLimiter');
const { addLead } = require('../data/leadStore');
const { sendLeadNotification } = require('../services/emailNotifications');

const sanitize = (str) => String(str || '').trim();

const validServices = [
  'Web Development',
  'AI / ML',
  'Cloud & DevOps',
  'Mobile Apps',
  'Digital Solutions',
  'Software & Integrations',
  'UI/UX Design',
];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^[+()\-\d\s]{7,20}$/;

router.post('/', contactLimiter, async (req, res, next) => {
  const errors = {};
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Please submit the inquiry as a JSON object.',
    });
  }

  if (req.body.website) {
    return res.status(400).json({
      success: false,
      message: 'The inquiry could not be accepted. Please review the form and try again.',
    });
  }

  const fields = {};
  const limits = {
    name: 150,
    email: 254,
    phone: 20,
    company: 150,
    service: 100,
    budget: 100,
    timeline: 100,
    message: 2000,
    sourcePage: 200,
  };

  for (const [field, maxLength] of Object.entries(limits)) {
    const value = req.body[field];
    if (value === undefined || value === null || value === '') {
      fields[field] = '';
    } else if (typeof value !== 'string') {
      errors[field] = 'This field must be text.';
    } else if (value.trim().length > maxLength) {
      errors[field] = `This field must be ${maxLength} characters or fewer.`;
    } else {
      fields[field] = sanitize(value);
    }
  }

  const { name, email, phone, company, service, budget, timeline, message } = fields;
  const sourcePage = fields.sourcePage || '/';

  if (
    !errors.sourcePage &&
    (!sourcePage.startsWith('/') || sourcePage.startsWith('//') || /[?#]/.test(sourcePage))
  ) {
    errors.sourcePage = 'The inquiry source must be a valid page path.';
  }

  if (!errors.name && (!name || name.length < 2)) {
    errors.name = 'Please enter your full name (at least 2 characters).';
  }

  if (!errors.email && (!email || !emailRegex.test(email))) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!errors.phone && phone && !phoneRegex.test(phone)) {
    errors.phone = 'Please enter a valid phone number.';
  }

  if (!errors.service && (!service || !validServices.includes(service))) {
    errors.service = 'Please select a valid service.';
  }

  if (!errors.message && (!message || message.length < 10)) {
    errors.message = 'Project details should be 10-2000 characters long.';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Please fix the highlighted fields and try again.',
      errors,
    });
  }

  const referenceId = `VL-${randomUUID().toUpperCase()}`;
  const newEnquiry = {
    id: referenceId,
    referenceId,
    name,
    email,
    phone: phone || null,
    company: company || null,
    service,
    budget: budget || null,
    timeline: timeline || null,
    message,
    sourcePage,
    status: 'new',
    createdAt: new Date().toISOString(),
  };

  let savedLead;
  try {
    savedLead = addLead(newEnquiry);
  } catch (error) {
    return next(error);
  }
  console.log('[NEW ENQUIRY RECEIVED]:', referenceId);

  try {
    await sendLeadNotification(savedLead);
    console.log('[ENQUIRY NOTIFICATION SENT]:', referenceId);
  } catch (error) {
    console.error('[ENQUIRY NOTIFICATION FAILED]:', referenceId, error.message);
  }

  return res.status(201).json({
    success: true,
    message: `Thanks, ${name}! Your inquiry has been received. Reference ID: ${referenceId}.`,
    data: {
      referenceId,
      createdAt: savedLead.createdAt,
      status: savedLead.status,
    },
  });
});

module.exports = router;
