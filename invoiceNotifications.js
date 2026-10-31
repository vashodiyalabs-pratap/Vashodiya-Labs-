const { fail } = require('./invoices');

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sendInvoiceEmail = async (invoice, invoiceUrl) => {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.EMAIL_FROM;
  if (!apiKey || !sender) {
    fail(
      503,
      'Invoice email could not be sent. Configure RESEND_API_KEY and EMAIL_FROM; copy and share the invoice link manually.',
    );
  }

  const amount = (invoice.totalPaise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
  });
  const text = [
    `GST invoice ${invoice.invoiceNumber}`,
    `Hello ${invoice.clientName},`,
    `Please review your invoice for ${amount}.`,
    `Due date: ${invoice.dueDate}`,
    `Invoice and secure payment link: ${invoiceUrl}`,
    '',
    invoice.sellerName,
  ].join('\n');
  const html = `
    <h2>GST invoice ${escapeHtml(invoice.invoiceNumber)}</h2>
    <p>Hello ${escapeHtml(invoice.clientName)},</p>
    <p>Please review the invoice for <strong>${escapeHtml(amount)}</strong>.</p>
    <p>Due date: ${escapeHtml(invoice.dueDate)}</p>
    <p><a href="${escapeHtml(invoiceUrl)}">View invoice and pay securely</a></p>
    <p>${escapeHtml(invoice.sellerName)}</p>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: [invoice.clientEmail],
      reply_to: process.env.ENQUIRY_NOTIFY_EMAIL || undefined,
      subject: `GST invoice ${invoice.invoiceNumber} from ${invoice.sellerName}`,
      text,
      html,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.error('[INVOICE EMAIL ERROR]:', response.status);
    fail(
      502,
      'Invoice was created, but email could not be sent. Copy and share the invoice link manually.',
    );
  }
};

module.exports = { sendInvoiceEmail };
