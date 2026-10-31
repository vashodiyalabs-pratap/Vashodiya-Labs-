const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};

const getSellerProfile = () => {
  const gstRegistered =
    (process.env.INVOICE_GST_REGISTERED || '').trim().toLowerCase() === 'false' ? false : true;
  const seller = {
    name: (process.env.INVOICE_SELLER_NAME || '').trim(),
    gstin: (process.env.INVOICE_SELLER_GSTIN || '').trim().toUpperCase(),
    address: (process.env.INVOICE_SELLER_ADDRESS || '').trim(),
    state: (process.env.INVOICE_SELLER_STATE || '').trim(),
    gstRegistered,
  };

  if (
    !seller.name ||
    !seller.address ||
    !seller.state ||
    (seller.gstRegistered && !GSTIN_PATTERN.test(seller.gstin))
  ) {
    fail(
      503,
      'Invoice creation is unavailable until the seller legal name, address, state, and applicable GST details are configured.',
    );
  }

  if (!seller.gstRegistered) seller.gstin = '';
  return seller;
};

const getPublicSiteUrl = () => {
  let siteUrl;
  try {
    siteUrl = new URL(process.env.PUBLIC_SITE_URL || '');
  } catch {
    fail(503, 'Invoice links are unavailable until PUBLIC_SITE_URL is configured.');
  }

  if (
    siteUrl.protocol !== 'https:' ||
    siteUrl.username ||
    siteUrl.password ||
    siteUrl.pathname !== '/' ||
    siteUrl.search ||
    siteUrl.hash
  ) {
    fail(503, 'PUBLIC_SITE_URL must be an HTTPS site origin without a path.');
  }

  return siteUrl.origin;
};

const validateInvoiceInput = (input, seller) => {
  const fields = {};
  const limits = {
    clientName: 150,
    clientEmail: 254,
    clientGstin: 15,
    billingAddress: 500,
    placeOfSupplyState: 100,
    description: 500,
    subtotal: 20,
    dueDate: 10,
    leadReferenceId: 50,
  };
  const errors = {};

  for (const [field, maxLength] of Object.entries(limits)) {
    const raw = input[field];
    if (raw === undefined || raw === null || raw === '') {
      fields[field] = '';
    } else if (typeof raw !== 'string' && field !== 'subtotal') {
      errors[field] = 'This field must be text.';
    } else if (String(raw).trim().length > maxLength) {
      errors[field] = `This field must be ${maxLength} characters or fewer.`;
    } else {
      fields[field] = String(raw).trim();
    }
  }

  if (!fields.clientName || fields.clientName.length < 2) {
    errors.clientName = 'Client name must be at least 2 characters.';
  }
  if (!EMAIL_PATTERN.test(fields.clientEmail)) {
    errors.clientEmail = 'Enter a valid client email.';
  }
  if (!fields.billingAddress) {
    errors.billingAddress = 'Client billing address is required for the invoice.';
  }
  if (seller?.gstRegistered !== false && !fields.placeOfSupplyState) {
    errors.placeOfSupplyState = 'Place of supply state is required for GST calculation.';
  }
  if (!fields.description || fields.description.length < 2) {
    errors.description = 'Describe the project or service on the invoice.';
  }
  if (fields.clientGstin && !GSTIN_PATTERN.test(fields.clientGstin.toUpperCase())) {
    errors.clientGstin = 'Enter a valid 15-character GSTIN or leave it blank.';
  }

  const amountText = fields.subtotal;
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(amountText)) {
    errors.subtotal = 'Enter a positive invoice subtotal with no more than 2 decimal places.';
  } else {
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
      errors.subtotal = 'Invoice subtotal must be greater than zero and at most INR 1,00,00,000.';
    } else {
      fields.subtotalPaise = Math.round(amount * 100);
    }
  }

  const dueDate = new Date(`${fields.dueDate}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate) ||
    Number.isNaN(dueDate.getTime()) ||
    dueDate.toISOString().slice(0, 10) !== fields.dueDate ||
    dueDate < today
  ) {
    errors.dueDate = 'Due date must be today or a future calendar date.';
  }

  if (fields.leadReferenceId && !/^VL-[A-F0-9-]+$/i.test(fields.leadReferenceId)) {
    errors.leadReferenceId = 'The associated lead reference is invalid.';
  }

  if (Object.keys(errors).length) {
    const error = new Error('Please correct the highlighted invoice fields.');
    error.status = 400;
    error.errors = errors;
    throw error;
  }

  return {
    clientName: fields.clientName,
    clientEmail: fields.clientEmail,
    clientGstin: fields.clientGstin.toUpperCase(),
    billingAddress: fields.billingAddress,
    placeOfSupplyState: fields.placeOfSupplyState,
    description: fields.description,
    subtotalPaise: fields.subtotalPaise,
    dueDate: fields.dueDate,
    leadReferenceId: fields.leadReferenceId || null,
  };
};

const getStripeConfiguration = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey) || !webhookSecret.startsWith('whsec_')) {
    return null;
  }
  return { secretKey, webhookSecret };
};

module.exports = {
  GSTIN_PATTERN,
  fail,
  getPublicSiteUrl,
  getSellerProfile,
  getStripeConfiguration,
  validateInvoiceInput,
};
