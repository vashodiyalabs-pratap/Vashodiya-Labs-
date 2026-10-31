const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sendLeadNotification = async (lead) => {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.ENQUIRY_NOTIFY_EMAIL;
  const sender = process.env.EMAIL_FROM;

  if (!apiKey || !recipient || !sender) {
    throw new Error('Email notification settings are incomplete.');
  }

  const text = [
    `New project inquiry ${lead.referenceId}`,
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone || 'Not provided'}`,
    `Company: ${lead.company || 'Not provided'}`,
    `Service: ${lead.service}`,
    `Budget: ${lead.budget || 'Not provided'}`,
    `Timeline: ${lead.timeline || 'Not provided'}`,
    `Source page: ${lead.sourcePage || '/'}`,
    '',
    'Project details:',
    lead.message,
  ].join('\n');

  const html = `
    <h2>New project inquiry</h2>
    <p><strong>Reference:</strong> ${escapeHtml(lead.referenceId)}</p>
    <p><strong>Name:</strong> ${escapeHtml(lead.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(lead.email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(lead.phone || 'Not provided')}</p>
    <p><strong>Company:</strong> ${escapeHtml(lead.company || 'Not provided')}</p>
    <p><strong>Service:</strong> ${escapeHtml(lead.service)}</p>
    <p><strong>Budget:</strong> ${escapeHtml(lead.budget || 'Not provided')}</p>
    <p><strong>Timeline:</strong> ${escapeHtml(lead.timeline || 'Not provided')}</p>
    <p><strong>Source page:</strong> ${escapeHtml(lead.sourcePage || '/')}</p>
    <p><strong>Project details:</strong></p>
    <p>${escapeHtml(lead.message).replace(/\n/g, '<br>')}</p>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      reply_to: lead.email,
      subject: `New project inquiry ${lead.referenceId}`,
      text,
      html,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Email provider returned HTTP ${response.status}.`);
  }
};

module.exports = { sendLeadNotification };
