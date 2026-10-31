const { timingSafeEqual, createHmac } = require('node:crypto');
const { getPublicSiteUrl, getStripeConfiguration } = require('./invoices');

const stripeRequest = async (path, options = {}) => {
  const configuration = getStripeConfiguration();
  if (!configuration) {
    const error = new Error(
      'Online payments are unavailable until Stripe API and webhook secrets are configured.',
    );
    error.status = 503;
    throw error;
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${configuration.secretKey}`,
      ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    console.error(
      '[STRIPE API ERROR]:',
      response.status,
      result?.error?.type || 'invalid response',
    );
    const error = new Error(
      'Stripe could not process this payment request. Please try again later.',
    );
    error.status = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return result;
};

const createCheckoutSession = async (token) => {
  const {
    getInvoiceCheckout,
    findInvoiceByToken,
    saveInvoiceCheckout,
  } = require('../data/leadStore');
  const invoice = findInvoiceByToken(token);
  if (!invoice) {
    const error = new Error('Invoice not found.');
    error.status = 404;
    throw error;
  }
  if (invoice.status === 'paid') {
    const error = new Error('This invoice has already been paid.');
    error.status = 409;
    throw error;
  }

  const existing = getInvoiceCheckout(invoice.id);
  if (existing?.sessionId) {
    const currentSession = await stripeRequest(
      `/checkout/sessions/${encodeURIComponent(existing.sessionId)}`,
    );
    if (
      currentSession.status === 'open' &&
      currentSession.url &&
      currentSession.amount_total === invoice.totalPaise &&
      currentSession.currency === 'inr' &&
      currentSession.metadata?.invoice_number === invoice.invoiceNumber
    ) {
      return currentSession.url;
    }
    if (currentSession.status === 'complete') {
      const error = new Error(
        'Payment confirmation is in progress. Refresh this invoice in a moment.',
      );
      error.status = 409;
      throw error;
    }
  }

  const siteUrl = getPublicSiteUrl();
  const invoiceUrl = `${siteUrl}/invoice/${encodeURIComponent(token)}`;
  const form = new URLSearchParams({
    mode: 'payment',
    customer_email: invoice.clientEmail,
    client_reference_id: invoice.invoiceNumber,
    success_url: `${invoiceUrl}?paid=1`,
    cancel_url: invoiceUrl,
    'metadata[invoice_number]': invoice.invoiceNumber,
    'payment_intent_data[description]': `Payment for ${invoice.invoiceNumber}`,
  });
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'inr');
  form.set('line_items[0][price_data][unit_amount]', String(invoice.totalPaise));
  form.set('line_items[0][price_data][product_data][name]', `Invoice ${invoice.invoiceNumber}`);
  form.set(
    'line_items[0][price_data][product_data][description]',
    invoice.description.slice(0, 350),
  );

  const session = await stripeRequest('/checkout/sessions', {
    method: 'POST',
    headers: { 'Idempotency-Key': `vashodiya-${invoice.id}-${existing?.sessionId || 'initial'}` },
    body: form,
  });
  if (
    session.mode !== 'payment' ||
    !session.id ||
    !session.url ||
    session.amount_total !== invoice.totalPaise ||
    session.currency !== 'inr' ||
    session.metadata?.invoice_number !== invoice.invoiceNumber
  ) {
    throw new Error('Stripe returned an incomplete checkout session.');
  }
  saveInvoiceCheckout(invoice.id, session.id, session.url);
  return session.url;
};

const verifyStripeSignature = (rawBody, signatureHeader, webhookSecret, now = Date.now()) => {
  if (!Buffer.isBuffer(rawBody) || typeof signatureHeader !== 'string') return false;
  const values = signatureHeader.split(',').map((item) => item.split('='));
  const timestamp = values.find(([name]) => name === 't')?.[1];
  const signatures = values.filter(([name]) => name === 'v1').map(([, value]) => value);
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !signatures.length ||
    Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300
  ) {
    return false;
  }

  const expected = createHmac('sha256', webhookSecret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest();
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const provided = Buffer.from(signature, 'hex');
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
};

const handleStripeWebhook = (request, response) => {
  const configuration = getStripeConfiguration();
  if (!configuration) {
    return response
      .status(503)
      .json({ success: false, message: 'Stripe webhook is not configured.' });
  }

  if (
    !verifyStripeSignature(
      request.body,
      request.get('stripe-signature'),
      configuration.webhookSecret,
    )
  ) {
    return response
      .status(400)
      .json({ success: false, message: 'Invalid Stripe webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(request.body.toString('utf8'));
  } catch {
    return response
      .status(400)
      .json({ success: false, message: 'Invalid Stripe webhook payload.' });
  }

  if (!event || typeof event.type !== 'string' || !event.data?.object) {
    return response.status(400).json({ success: false, message: 'Invalid Stripe event payload.' });
  }

  if (
    ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)
  ) {
    const session = event.data.object;
    const invoiceNumber = session.metadata?.invoice_number;
    if (
      session.payment_status === 'paid' &&
      String(session.currency).toLowerCase() === 'inr' &&
      Number.isSafeInteger(session.amount_total) &&
      session.id &&
      invoiceNumber
    ) {
      const { markInvoicePaid } = require('../data/leadStore');
      markInvoicePaid(
        invoiceNumber,
        session.id,
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id,
        Number.isSafeInteger(event.created)
          ? new Date(event.created * 1000).toISOString()
          : new Date().toISOString(),
        session.amount_total,
      );
    }
  }

  return response.status(200).json({ received: true });
};

module.exports = {
  createCheckoutSession,
  handleStripeWebhook,
  verifyStripeSignature,
};
