const invoiceMessage = document.getElementById('invoiceMessage');
const invoicePaper = document.getElementById('invoicePaper');
const paymentStatus = document.getElementById('paymentStatus');
const payButton = document.getElementById('payButton');
const paymentNote = document.getElementById('paymentNote');
const printButton = document.getElementById('printButton');
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const invoiceToken = window.location.pathname.split('/').filter(Boolean).at(-1);
const apiBase = (window.VASHODIYA_CONFIG?.apiBaseUrl || window.location.origin).replace(/\/+$/, '');
let paymentEnabled = false;

function formatAmount(paise) {
  return currency.format(paise / 100);
}

function showMessage(message, type = '') {
  invoiceMessage.textContent = message;
  if (type) invoiceMessage.dataset.state = type;
  else delete invoiceMessage.dataset.state;
}

function setText(id, text) {
  document.getElementById(id).textContent = text || '—';
}

function formatInvoiceDate(date, options = { dateStyle: 'medium' }) {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, options).format(value);
}

function renderInvoice({ invoice, seller, paymentEnabled: canPay }) {
  invoicePaper.hidden = false;
  showMessage('');
  paymentEnabled = canPay;
  const isTaxInvoice = invoice.gstRate > 0;
  document.title = `${invoice.invoiceNumber} | Invoice`;
  document.getElementById('invoiceDocumentType').textContent = isTaxInvoice
    ? 'TAX INVOICE'
    : 'INVOICE';
  setText('invoiceNumber', invoice.invoiceNumber);
  setText('sellerName', seller.name);
  setText('sellerAddress', seller.address);
  const sellerGstinRow = document.getElementById('sellerGstinRow');
  sellerGstinRow.textContent = isTaxInvoice ? `GSTIN: ${seller.gstin}` : 'Not registered under GST';
  setText('clientName', invoice.clientName);
  setText('clientAddress', invoice.billingAddress);
  setText('clientGstin', invoice.clientGstin);
  document.getElementById('clientGstinRow').hidden = !invoice.clientGstin;
  const email = document.getElementById('clientEmail');
  email.textContent = invoice.clientEmail;
  email.href = `mailto:${invoice.clientEmail}`;
  setText('issueDate', formatInvoiceDate(invoice.createdAt));
  setText('dueDate', formatInvoiceDate(`${invoice.dueDate}T00:00:00`));
  setText('placeOfSupply', invoice.placeOfSupplyState);
  document.getElementById('placeOfSupplyRow').hidden = !isTaxInvoice;
  setText('description', invoice.description);
  setText('subtotal', formatAmount(invoice.subtotalPaise));
  setText('subtotalTotal', formatAmount(invoice.subtotalPaise));
  setText('totalDue', formatAmount(invoice.totalPaise));
  paymentStatus.textContent =
    invoice.status === 'paid'
      ? 'Paid'
      : invoice.status === 'cancelled'
        ? 'Cancelled'
        : 'Payment due';
  paymentStatus.dataset.status = invoice.status;
  document.getElementById('cgstRow').hidden = invoice.gstType !== 'intra';
  document.getElementById('sgstRow').hidden = invoice.gstType !== 'intra';
  document.getElementById('igstRow').hidden = invoice.gstType !== 'inter';
  setText('cgstLabel', `CGST (${invoice.gstRate / 2}%)`);
  setText('sgstLabel', `SGST (${invoice.gstRate / 2}%)`);
  setText('igstLabel', `IGST (${invoice.gstRate}%)`);
  setText('cgstAmount', formatAmount(invoice.cgstPaise));
  setText('sgstAmount', formatAmount(invoice.sgstPaise));
  setText('igstAmount', formatAmount(invoice.igstPaise));
  document.getElementById('secureNote').hidden = !canPay;

  payButton.hidden = invoice.status !== 'pending' || !canPay;
  if (invoice.status === 'paid') {
    paymentNote.textContent = `Payment received on ${formatInvoiceDate(invoice.paidAt)}. Thank you for your business.`;
  } else if (invoice.status === 'cancelled') {
    paymentNote.textContent = 'This invoice is no longer payable. Please contact Vashodiya Labs.';
  } else if (!canPay) {
    paymentNote.textContent =
      'Online payment is not available right now. Please contact Vashodiya Labs for another payment method.';
  } else {
    paymentNote.textContent =
      'Please complete payment by the due date. Secure checkout is provided by Stripe.';
  }
}

async function loadInvoice() {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(invoiceToken || '')) {
    showMessage('This invoice link is invalid or has expired.', 'error');
    return null;
  }
  const response = await fetch(`${apiBase}/api/invoices/${encodeURIComponent(invoiceToken)}`, {
    cache: 'no-store',
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || 'This invoice could not be loaded.');
  }
  renderInvoice(result.data);
  return result.data.invoice;
}

async function confirmPaymentReturn() {
  const query = new URLSearchParams(window.location.search);
  if (query.get('paid') !== '1') return;
  showMessage('Payment submitted. Waiting for Stripe to confirm it…');
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const invoice = await loadInvoice();
      if (invoice?.status === 'paid') {
        showMessage('Payment confirmed. Thank you!', 'success');
        return;
      }
    } catch (error) {
      console.error('Could not refresh invoice payment status:', error);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  showMessage(
    'Stripe returned successfully. Payment confirmation is still processing; refresh this page shortly.',
  );
}

payButton.addEventListener('click', async () => {
  if (!paymentEnabled || payButton.disabled) return;
  payButton.disabled = true;
  showMessage('Opening secure Stripe checkout…');
  try {
    const response = await fetch(
      `${apiBase}/api/invoices/${encodeURIComponent(invoiceToken)}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new Error(result?.message || 'Checkout could not be started.');
    }
    const checkout = new URL(result.data.checkoutUrl);
    if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.stripe.com') {
      throw new Error('Stripe returned an unexpected checkout URL.');
    }
    window.location.assign(checkout.href);
  } catch (error) {
    showMessage(error.message, 'error');
    payButton.disabled = false;
  }
});

printButton.addEventListener('click', () => window.print());

loadInvoice()
  .then(confirmPaymentReturn)
  .catch((error) => showMessage(error.message, 'error'));
