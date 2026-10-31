const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, mock, test } = require('node:test');

const adminKey = 'local-backend-test-key-at-least-32-chars';
let baseUrl;
let databasePath;
let serverProcess;
let serverError = '';

const findAvailablePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
};

before(async () => {
  const port = await findAvailablePort();
  databasePath = path.join(os.tmpdir(), `vashodiya-backend-test-${process.pid}.sqlite`);
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: databasePath,
      ADMIN_API_KEY: adminKey,
      INVOICE_TOKEN_SECRET: 'local-invoice-token-secret-for-tests-32chars',
      INVOICE_SELLER_NAME: 'Vashodiya Labs Private Limited',
      INVOICE_SELLER_GSTIN: '24AAAAA0000A1Z5',
      INVOICE_SELLER_ADDRESS: 'Test business address, Ahmedabad, Gujarat',
      INVOICE_SELLER_STATE: 'Gujarat',
      PUBLIC_SITE_URL: 'https://vashodiyalabs.netlify.app',
      STRIPE_SECRET_KEY: 'sk_test_vashodiyalabsfixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_vashodiyalabsfixture',
      CORS_ORIGINS: baseUrl,
      RESEND_API_KEY: '',
      ENQUIRY_NOTIFY_EMAIL: '',
      EMAIL_FROM: '',
      DATABASE_BACKUP_INTERVAL_HOURS: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverError += chunk.toString();
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Backend exited before starting: ${serverError}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server can take a short time to initialize its SQLite database.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Backend did not become healthy: ${serverError}`);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once('exit', resolve));
  }

  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${databasePath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('health reports the SQLite database is ready', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.database, 'ok');
});

test('Express serves the Netlify publish directory locally', async () => {
  const [homepage, stylesheet] = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/VashodiyaLabs.css`),
  ]);

  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /Vashodiya Labs \| Digital Innovation Studio/);
  assert.equal(stylesheet.status, 200);
});

test('valid contact enquiry is persisted and receives a reference ID', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Backend Integration Test',
      email: 'backend-test@example.com',
      service: 'Web Development',
      message: 'Please save this test enquiry in the isolated test database.',
      sourcePage: '/web-development',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.match(body.data.referenceId, /^VL-[A-F0-9-]+$/);
  assert.equal(body.data.status, 'new');
});

test('owner email notification includes reply-to and the originating service page', async () => {
  const { sendLeadNotification } = require('../services/emailNotifications');
  const originalEnvironment = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ENQUIRY_NOTIFY_EMAIL: process.env.ENQUIRY_NOTIFY_EMAIL,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.ENQUIRY_NOTIFY_EMAIL = 'owner@example.com';
  process.env.EMAIL_FROM = 'Vashodiya Labs <leads@example.com>';
  let requestBody;
  const fetchMock = mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    requestBody = JSON.parse(options.body);
    return new Response(null, { status: 200 });
  });

  try {
    await sendLeadNotification({
      referenceId: 'VL-NOTIFICATION-TEST',
      name: 'Notification Test',
      email: 'client@example.com',
      service: 'Web Development',
      message: '<script>not markup</script>',
      sourcePage: '/web-development',
    });

    assert.equal(requestBody.reply_to, 'client@example.com');
    assert.match(requestBody.text, /Source page: \/web-development/);
    assert.match(requestBody.html, /&lt;script&gt;not markup&lt;\/script&gt;/);
  } finally {
    fetchMock.mock.restore();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('invalid inquiry values return field validation errors', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: { unexpected: 'object' },
      email: 'not-an-email',
      service: 'Unknown service',
      message: 'short',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.ok(body.errors.name);
  assert.ok(body.errors.email);
  assert.ok(body.errors.service);
  assert.ok(body.errors.message);
});

test('non-object inquiry bodies and unknown API paths return JSON errors', async () => {
  const invalidBody = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(['not', 'an', 'object']),
  });
  const unknownEndpoint = await fetch(`${baseUrl}/api/not-a-route`);

  assert.equal(invalidBody.status, 400);
  assert.equal(unknownEndpoint.status, 404);
  assert.match(unknownEndpoint.headers.get('content-type'), /application\/json/);
});

test('contact honeypot rejects automated submissions without storing a lead', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Automated visitor',
      email: 'bot@example.com',
      service: 'Web Development',
      message: 'This should not be stored because the honeypot was filled.',
      website: 'spam',
    }),
  });
  const body = await response.json();
  const leadsResponse = await fetch(`${baseUrl}/api/admin/leads?search=Automated%20visitor`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const leadsBody = await leadsResponse.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.equal(leadsBody.data.total, 0);
});

test('admin leads stay protected and support paginated search', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/admin/leads`);
  const response = await fetch(`${baseUrl}/api/admin/leads?search=backend-test&page=1&limit=10`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const body = await response.json();

  assert.equal(unauthorized.status, 401);
  assert.equal(response.status, 200);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.items[0].email, 'backend-test@example.com');
  assert.deepEqual(body.data.pagination, { page: 1, limit: 10, totalPages: 1 });
});

test('admin pagination rejects invalid limits', async () => {
  const response = await fetch(`${baseUrl}/api/admin/leads?limit=1000`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });

  assert.equal(response.status, 400);
});

test('admin dashboard is served privately and monthly enquiry counts are available', async () => {
  const [dashboard, response] = await Promise.all([
    fetch(`${baseUrl}/admin`),
    fetch(`${baseUrl}/api/admin/summary`, {
      headers: { authorization: `Bearer ${adminKey}` },
    }),
  ]);
  const body = await response.json();

  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Admin dashboard/);
  assert.equal(response.status, 200);
  assert.equal(body.data.monthlyEnquiries.length, 12);
  assert.equal(
    body.data.monthlyEnquiries.reduce((sum, month) => sum + month.count, 0),
    1,
  );
});

test('admin can save and retrieve validated follow-up notes', async () => {
  const leadsResponse = await fetch(`${baseUrl}/api/admin/leads?limit=10`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const leadsBody = await leadsResponse.json();
  const identifier = leadsBody.data.items[0].referenceId;
  const saveResponse = await fetch(`${baseUrl}/api/admin/leads/${identifier}/notes`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ note: 'Call the client next Tuesday.' }),
  });
  const savedBody = await saveResponse.json();
  const listResponse = await fetch(`${baseUrl}/api/admin/leads/${identifier}/notes`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const listBody = await listResponse.json();
  const invalidResponse = await fetch(`${baseUrl}/api/admin/leads/${identifier}/notes`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ note: '   ' }),
  });

  assert.equal(saveResponse.status, 201);
  assert.equal(savedBody.data.note, 'Call the client next Tuesday.');
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.data.length, 1);
  assert.equal(listBody.data[0].note, 'Call the client next Tuesday.');
  assert.equal(invalidResponse.status, 400);
});

test('admin can change a lead status and summary totals reflect the update', async () => {
  const leadsResponse = await fetch(`${baseUrl}/api/admin/leads?limit=10`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const leadsBody = await leadsResponse.json();
  const identifier = leadsBody.data.items[0].referenceId;
  const updateResponse = await fetch(`${baseUrl}/api/admin/leads/${identifier}/status`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${adminKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status: 'contacted' }),
  });
  const updatedBody = await updateResponse.json();
  const summaryResponse = await fetch(`${baseUrl}/api/admin/summary`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const summaryBody = await summaryResponse.json();

  assert.equal(updateResponse.status, 200);
  assert.equal(updatedBody.data.status, 'contacted');
  assert.equal(summaryBody.data.contacted, 1);
  assert.equal(summaryBody.data.new, 0);
});

test('non-GST seller invoices have no GST and migrate existing invoice records', () => {
  const isolatedDatabasePath = path.join(
    os.tmpdir(),
    `vashodiya-non-gst-invoice-${process.pid}.sqlite`,
  );
  const script = `
    const assert = require('node:assert/strict');
    const { DatabaseSync } = require('node:sqlite');
    const legacyDatabase = new DatabaseSync(process.env.DATABASE_PATH);
    legacyDatabase.exec(\`
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        public_token_hash TEXT NOT NULL UNIQUE,
        lead_reference_id TEXT,
        seller_name TEXT NOT NULL,
        seller_gstin TEXT NOT NULL,
        seller_address TEXT NOT NULL,
        seller_state TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_email TEXT NOT NULL,
        client_gstin TEXT,
        billing_address TEXT NOT NULL,
        place_of_supply_state TEXT NOT NULL,
        description TEXT NOT NULL,
        subtotal_paise INTEGER NOT NULL CHECK (subtotal_paise > 0),
        gst_rate INTEGER NOT NULL CHECK (gst_rate = 18),
        gst_type TEXT NOT NULL CHECK (gst_type IN ('intra', 'inter')),
        cgst_paise INTEGER NOT NULL DEFAULT 0,
        sgst_paise INTEGER NOT NULL DEFAULT 0,
        igst_paise INTEGER NOT NULL DEFAULT 0,
        total_paise INTEGER NOT NULL CHECK (total_paise > 0),
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
        checkout_session_id TEXT,
        checkout_url TEXT,
        payment_intent_id TEXT,
        paid_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO invoices VALUES (
        'legacy-id', 'VL-20260101-0001', '${'a'.repeat(64)}', NULL,
        'Old seller', '24AAAAA0000A1Z5', 'Old address', 'Gujarat',
        'Old client', 'old@example.com', NULL, 'Old client address', 'Gujarat',
        'Old project', 10000, 18, 'intra', 900, 900, 0, 11800,
        '2026-12-31', 'pending', NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    \`);
    legacyDatabase.close();

    const store = require('./data/leadStore');
    const { getSellerProfile, validateInvoiceInput } = require('./services/invoices');
    const legacy = store.listInvoices(10);
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].invoiceNumber, 'VL-20260101-0001');
    const seller = getSellerProfile();
    assert.equal(seller.gstRegistered, false);
    assert.equal(seller.gstin, '');
    const input = validateInvoiceInput({
      clientName: 'No GST Client',
      clientEmail: 'client@example.com',
      billingAddress: 'Client billing address',
      description: 'Mobile application development',
      subtotal: '1000.00',
      dueDate: '2099-01-01'
    }, seller);
    const created = store.createInvoice(input, seller).invoice;
    assert.equal(created.gstRate, 0);
    assert.equal(created.gstType, 'none');
    assert.equal(created.cgstPaise, 0);
    assert.equal(created.sgstPaise, 0);
    assert.equal(created.igstPaise, 0);
    assert.equal(created.totalPaise, created.subtotalPaise);
    console.log('Non-GST invoice and migration test passed.');
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_PATH: isolatedDatabasePath,
        INVOICE_TOKEN_SECRET: 'local-invoice-token-secret-for-tests-32chars',
        INVOICE_GST_REGISTERED: 'false',
        INVOICE_SELLER_NAME: 'Pratap Vashodiya',
        INVOICE_SELLER_ADDRESS: 'Test billing address',
        INVOICE_SELLER_STATE: 'Punjab',
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Non-GST invoice and migration test passed/);
  } finally {
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${isolatedDatabasePath}${suffix}`, { force: true });
    }
  }
});

test('admin can create a GST invoice and clients receive an unguessable private invoice page', async () => {
  const leadResponse = await fetch(`${baseUrl}/api/admin/leads?limit=1`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const leadBody = await leadResponse.json();
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const createResponse = await fetch(`${baseUrl}/api/admin/invoices`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      leadReferenceId: leadBody.data.items[0].referenceId,
      clientName: 'GST Invoice Test Client',
      clientEmail: 'invoice-client@example.com',
      clientGstin: '',
      billingAddress: '12 Test Road, Ahmedabad, Gujarat',
      placeOfSupplyState: 'Gujarat',
      description: 'Website development milestone',
      subtotal: '1000.00',
      dueDate,
    }),
  });
  const created = await createResponse.json();
  const clientUrl = new URL(created.data.clientUrl);
  const token = clientUrl.pathname.split('/').at(-1);
  const invoiceResponse = await fetch(`${baseUrl}/api/invoices/${token}`);
  const invoiceData = await invoiceResponse.json();
  const invoicePage = await fetch(`${baseUrl}/invoice/${token}`);
  const pageHtml = await invoicePage.text();
  const invoiceStyles = await fetch(`${baseUrl}/invoice.css`);
  const cssText = await invoiceStyles.text();
  const invoiceScript = await fetch(`${baseUrl}/invoice.js`);
  const configScript = await fetch(`${baseUrl}/config.js`);
  const adminListResponse = await fetch(
    `${baseUrl}/api/admin/invoices/lead/${leadBody.data.items[0].referenceId}`,
    {
      headers: { authorization: `Bearer ${adminKey}` },
    },
  );
  const adminList = await adminListResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(created.success, true);
  assert.equal(created.data.notificationSent, false);
  assert.match(created.data.invoice.invoiceNumber, /^VL-\d{8}-\d{4}$/);
  assert.equal(created.data.invoice.subtotalPaise, 100000);
  assert.equal(created.data.invoice.cgstPaise, 9000);
  assert.equal(created.data.invoice.sgstPaise, 9000);
  assert.equal(created.data.invoice.igstPaise, 0);
  assert.equal(created.data.invoice.totalPaise, 118000);
  assert.equal(invoiceResponse.status, 200);
  assert.equal(invoiceData.data.paymentEnabled, true);
  assert.equal(invoiceData.data.invoice.invoiceNumber, created.data.invoice.invoiceNumber);
  assert.equal(Object.hasOwn(invoiceData.data.invoice, 'public_token_hash'), false);
  assert.equal(invoicePage.status, 200);
  assert.equal(invoiceStyles.status, 200);
  assert.equal(invoiceScript.status, 200);
  assert.equal(configScript.status, 200);
  assert.match(pageHtml, /href="\/invoice\.css\?v=2"/);
  assert.match(pageHtml, /src="\/config\.js"/);
  assert.match(pageHtml, /src="\/invoice\.js\?v=2"/);
  assert.match(pageHtml, /class="document-brand"/);
  assert.ok(pageHtml.includes('Project / service'));
  assert.match(pageHtml, /printButton/);
  const normalizedCss = cssText.replace(/\s+/g, ' ');
  assert.ok(normalizedCss.includes('@page { size: A4;'));
  assert.match(cssText, /@media print/);
  assert.ok(
    normalizedCss.includes('.invoice-footer .button, .secure-note { display: none !important;'),
  );
  assert.match(pageHtml, /Pay securely with Stripe/);
  assert.equal(adminList.data.length, 1);
  assert.equal(adminList.data[0].clientUrl, created.data.clientUrl);
});

test('GST invoice calculates IGST for a different place-of-supply state', async () => {
  const leadResponse = await fetch(`${baseUrl}/api/admin/leads?limit=1`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const leadBody = await leadResponse.json();
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const response = await fetch(`${baseUrl}/api/admin/invoices`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      leadReferenceId: leadBody.data.items[0].referenceId,
      clientName: 'Inter-state Client',
      clientEmail: 'interstate@example.com',
      billingAddress: '1 Test Road, Mumbai, Maharashtra',
      placeOfSupplyState: 'Maharashtra',
      description: 'Software implementation',
      subtotal: '250.50',
      dueDate,
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.data.invoice.gstType, 'inter');
  assert.equal(result.data.invoice.igstPaise, 4509);
  assert.equal(result.data.invoice.cgstPaise, 0);
  assert.equal(result.data.invoice.sgstPaise, 0);
  assert.equal(result.data.invoice.totalPaise, 29559);
});

test('Stripe Checkout charges the saved INR total and reuses an open session', () => {
  const script = `
    const assert = require('node:assert/strict');
    const store = require('./data/leadStore');
    const { createCheckoutSession } = require('./services/stripePayments');
    const invoice = store.listInvoices(100).find((entry) => entry.status === 'pending');
    assert.ok(invoice, 'a pending invoice is required for the checkout test');
    const token = store.deriveInvoiceToken(invoice.id);
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      const session = {
        id: 'cs_test_checkout',
        url: 'https://checkout.stripe.com/c/pay/test',
        mode: 'payment',
        status: 'open',
        amount_total: invoice.totalPaise,
        currency: 'inr',
        metadata: { invoice_number: invoice.invoiceNumber }
      };
      return new Response(JSON.stringify(session), { status: 200 });
    };
    (async () => {
      const firstUrl = await createCheckoutSession(token);
      const secondUrl = await createCheckoutSession(token);
      const form = new URLSearchParams(calls[0].options.body);
      assert.equal(firstUrl, 'https://checkout.stripe.com/c/pay/test');
      assert.equal(secondUrl, firstUrl);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
      assert.equal(calls[0].options.headers.Authorization, 'Bearer sk_test_vashodiyalabsfixture');
      assert.equal(form.get('line_items[0][price_data][currency]'), 'inr');
      assert.equal(form.get('line_items[0][price_data][unit_amount]'), String(invoice.totalPaise));
      assert.equal(form.get('metadata[invoice_number]'), invoice.invoiceNumber);
      assert.match(form.get('success_url'), /\\/invoice\\/[A-Za-z0-9_-]+\\?paid=1$/);
      console.log('Stripe Checkout test passed.');
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      INVOICE_TOKEN_SECRET: 'local-invoice-token-secret-for-tests-32chars',
      PUBLIC_SITE_URL: 'https://vashodiyalabs.netlify.app',
      STRIPE_SECRET_KEY: 'sk_test_vashodiyalabsfixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_vashodiyalabsfixture',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Stripe Checkout test passed/);
});

test('invoice validation rejects malformed amounts, GSTINs, and absent billing details', async () => {
  const response = await fetch(`${baseUrl}/api/admin/invoices`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      clientName: 'Invalid Invoice',
      clientEmail: 'not-an-email',
      clientGstin: 'bad-gstin',
      subtotal: '12.345',
      dueDate: 'not-a-date',
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.ok(result.errors.clientEmail);
  assert.ok(result.errors.clientGstin);
  assert.ok(result.errors.billingAddress);
  assert.ok(result.errors.subtotal);
  assert.ok(result.errors.dueDate);
});

test('Stripe webhook requires a valid signature and marks only matching paid invoices', async () => {
  const leadResponse = await fetch(`${baseUrl}/api/admin/leads?limit=1`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  const leadBody = await leadResponse.json();
  const invoicesResponse = await fetch(
    `${baseUrl}/api/admin/invoices/lead/${leadBody.data.items[0].referenceId}`,
    {
      headers: { authorization: `Bearer ${adminKey}` },
    },
  );
  const invoicesBody = await invoicesResponse.json();
  const invoice = invoicesBody.data[0];
  const token = new URL(invoice.clientUrl).pathname.split('/').at(-1);
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(databasePath);
  database
    .prepare(
      `
    UPDATE invoices SET checkout_session_id = ?
    WHERE invoice_number = ?
  `,
    )
    .run('cs_test_invoice_payment', invoice.invoiceNumber);
  database.close();

  const event = {
    id: 'evt_test_invoice_payment',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_invoice_payment',
        payment_intent: 'pi_test_invoice_payment',
        payment_status: 'paid',
        currency: 'inr',
        amount_total: invoice.totalPaise,
        metadata: { invoice_number: invoice.invoiceNumber },
      },
    },
  };
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = require('node:crypto')
    .createHmac('sha256', 'whsec_vashodiyalabsfixture')
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  const invalid = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${'0'.repeat(64)}`,
    },
    body: payload,
  });
  const accepted = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  });
  const publicInvoiceResponse = await fetch(`${baseUrl}/api/invoices/${token}`);
  const publicInvoice = await publicInvoiceResponse.json();

  assert.equal(invalid.status, 400);
  assert.equal(accepted.status, 200);
  assert.equal(publicInvoice.data.invoice.status, 'paid');
  assert.equal(publicInvoice.data.invoice.paymentIntentId, 'pi_test_invoice_payment');
});

test('Stripe signature verification rejects stale timestamps and tampered payloads', () => {
  const { verifyStripeSignature } = require('../services/stripePayments');
  const payload = Buffer.from('{"id":"evt_test"}');
  const secret = 'whsec_vashodiyalabsfixture';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = require('node:crypto')
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), payload]))
    .digest('hex');

  assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret), true);
  assert.equal(
    verifyStripeSignature(
      Buffer.from('{"id":"evt_tampered"}'),
      `t=${timestamp},v1=${signature}`,
      secret,
    ),
    false,
  );
  assert.equal(
    verifyStripeSignature(payload, `t=${timestamp - 1000},v1=${signature}`, secret),
    false,
  );
});

test('service landing pages include search metadata and service-specific content', async () => {
  const pages = [
    ['web-development', /Web Development &amp; Websites/],
    ['ai-ml', /AI &amp; Machine Learning Solutions/],
    ['cloud-devops', /Cloud &amp; DevOps Engineering/],
    ['mobile-apps', /Mobile App Development/],
    ['software-integrations', /Custom Software &amp; Integrations/],
    ['ui-ux-design', /UI\/UX Design &amp; Product Design/],
    ['digital-solutions', /Digital Solutions &amp; Product Engineering/],
  ];

  for (const [slug, titlePattern] of pages) {
    const response = await fetch(`${baseUrl}/${slug}`);
    const html = await response.text();
    assert.equal(response.status, 200, `${slug} should resolve`);
    assert.match(html, titlePattern, `${slug} should have a specific title`);
    assert.match(html, /name="description"/, `${slug} should have a meta description`);
    assert.match(html, new RegExp(`https://vashodiyalabs\\.netlify\\.app/${slug}`));
  }
});

test('robots and sitemap are served and cover all service landing pages', async () => {
  const [robotsResponse, sitemapResponse] = await Promise.all([
    fetch(`${baseUrl}/robots.txt`),
    fetch(`${baseUrl}/sitemap.xml`),
  ]);
  const robots = await robotsResponse.text();
  const sitemap = await sitemapResponse.text();

  assert.equal(robotsResponse.status, 200);
  assert.equal(sitemapResponse.status, 200);
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Sitemap: https:\/\/vashodiyalabs\.netlify\.app\/sitemap\.xml/);
  for (const slug of [
    'web-development',
    'ai-ml',
    'cloud-devops',
    'mobile-apps',
    'software-integrations',
    'ui-ux-design',
    'digital-solutions',
  ]) {
    assert.match(sitemap, new RegExp(`https://vashodiyalabs\\.netlify\\.app/${slug}`));
  }
});

test('contact API rejects malformed inquiry source paths', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Invalid Source Test',
      email: 'source@example.com',
      service: 'Web Development',
      message: 'A valid message to check source path validation.',
      sourcePage: '//outside.example/path',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.ok(body.errors.sourcePage);
});

test('SQLite backup script creates an integrity-checked copy of enquiry and note data', async () => {
  const backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vashodiya-backup-test-'));
  try {
    const backupResult = spawnSync(process.execPath, ['scripts/backup-database.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        BACKUP_DIR: backupDirectory,
      },
      encoding: 'utf8',
    });

    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backupName = fs.readdirSync(backupDirectory).find((name) => name.endsWith('.sqlite'));
    assert.ok(backupName);
    const { DatabaseSync } = require('node:sqlite');
    const backup = new DatabaseSync(path.join(backupDirectory, backupName), { readOnly: true });
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(backup.prepare('SELECT COUNT(*) AS total FROM leads').get().total, 1);
    assert.equal(backup.prepare('SELECT COUNT(*) AS total FROM follow_up_notes').get().total, 1);
    backup.close();
  } finally {
    for (const entry of fs.readdirSync(backupDirectory)) {
      fs.unlinkSync(path.join(backupDirectory, entry));
    }
    fs.rmdirSync(backupDirectory);
  }
});

test('SQLite enquiry and follow-up data persist after restarting the backend', async () => {
  const previousProcess = serverProcess;
  previousProcess.kill();
  await new Promise((resolve) => previousProcess.once('exit', resolve));

  const port = new URL(baseUrl).port;
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: port,
      DATABASE_PATH: databasePath,
      ADMIN_API_KEY: adminKey,
      CORS_ORIGINS: baseUrl,
      RESEND_API_KEY: '',
      ENQUIRY_NOTIFY_EMAIL: '',
      EMAIL_FROM: '',
      DATABASE_BACKUP_INTERVAL_HOURS: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverError += chunk.toString();
  });

  let response;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}/api/admin/leads?search=backend-test`, {
        headers: { authorization: `Bearer ${adminKey}` },
      });
      if (response.ok) break;
    } catch {
      // The restarted server can take a moment to open the existing database.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(response?.ok, `Backend did not recover after restart: ${serverError}`);
  const body = await response.json();
  assert.equal(body.data.total, 1);
  assert.equal(body.data.items[0].sourcePage, '/web-development');
  const notesResponse = await fetch(
    `${baseUrl}/api/admin/leads/${body.data.items[0].referenceId}/notes`,
    {
      headers: { authorization: `Bearer ${adminKey}` },
    },
  );
  const notesBody = await notesResponse.json();
  assert.equal(notesBody.data.length, 1);
  assert.equal(notesBody.data[0].note, 'Call the client next Tuesday.');
});

test('contact submissions are limited to five per IP within the rate window', async () => {
  const submit = () =>
    fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Rate Limit Test',
        email: 'rate-limit@example.com',
        service: 'Web Development',
        message: 'Verify the public inquiry endpoint rate limit.',
      }),
    });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const accepted = await submit();
    assert.equal(accepted.status, 201);
  }

  const limited = await submit();
  assert.equal(limited.status, 429);
});

test('admin API rate limits repeated unsuccessful authentication attempts', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/admin/summary`, {
      headers: { authorization: 'Bearer incorrect-admin-key' },
    });
    assert.equal(response.status, 401);
  }

  const limited = await fetch(`${baseUrl}/api/admin/summary`, {
    headers: { authorization: 'Bearer incorrect-admin-key' },
  });
  assert.equal(limited.status, 429);
});

test('admin API refuses an insufficiently long configured key', () => {
  const { requireAdminKey } = require('../middleware/adminAuth');
  const previousKey = process.env.ADMIN_API_KEY;
  let statusCode;
  let responseBody;
  process.env.ADMIN_API_KEY = 'too-short';

  try {
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };

    requireAdminKey({ get: () => 'Bearer too-short' }, response, () => {
      throw new Error('Admin middleware must reject a short configured key.');
    });

    assert.equal(statusCode, 503);
    assert.match(responseBody.message, /at least 32 characters/);
  } finally {
    if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousKey;
  }
});
