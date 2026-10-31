const fs = require('node:fs');
const path = require('node:path');
const { createHash, createHmac, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const validStatuses = ['new', 'contacted', 'qualified', 'in_progress', 'closed'];
const deriveInvoiceToken = (invoiceId) => {
  const secret = process.env.INVOICE_TOKEN_SECRET || '';
  if (secret.length < 32) {
    const error = new Error(
      'Invoice links are unavailable until INVOICE_TOKEN_SECRET is configured with at least 32 characters.',
    );
    error.status = 503;
    throw error;
  }
  return createHmac('sha256', secret).update(invoiceId).digest('base64url');
};
const configuredPath = process.env.DATABASE_PATH;
const databasePath = configuredPath
  ? path.resolve(configuredPath)
  : path.join(__dirname, 'leads.sqlite');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS leads (
    reference_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    company TEXT,
    service TEXT NOT NULL,
    budget TEXT,
    timeline TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('new', 'contacted', 'qualified', 'in_progress', 'closed')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
  CREATE INDEX IF NOT EXISTS leads_status_created_at_idx ON leads (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS follow_up_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_reference_id TEXT NOT NULL REFERENCES leads(reference_id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS follow_up_notes_lead_created_at_idx
    ON follow_up_notes (lead_reference_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    public_token_hash TEXT NOT NULL UNIQUE,
    lead_reference_id TEXT REFERENCES leads(reference_id),
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
    gst_rate INTEGER NOT NULL CHECK (gst_rate IN (0, 18)),
    gst_type TEXT NOT NULL CHECK (gst_type IN ('none', 'intra', 'inter')),
    cgst_paise INTEGER NOT NULL DEFAULT 0,
    sgst_paise INTEGER NOT NULL DEFAULT 0,
    igst_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL CHECK (total_paise > 0),
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'paid', 'cancelled')),
    checkout_session_id TEXT,
    checkout_url TEXT,
    payment_intent_id TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS invoices_created_at_idx ON invoices (created_at DESC);
  CREATE INDEX IF NOT EXISTS invoices_lead_created_at_idx
    ON invoices (lead_reference_id, created_at DESC);
`);

const invoiceSchema = database
  .prepare(
    `
  SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invoices'
`,
  )
  .get().sql;
if (!invoiceSchema.includes("gst_type IN ('none', 'intra', 'inter')")) {
  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE invoices_migrated (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      public_token_hash TEXT NOT NULL UNIQUE,
      lead_reference_id TEXT REFERENCES leads(reference_id),
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
      gst_rate INTEGER NOT NULL CHECK (gst_rate IN (0, 18)),
      gst_type TEXT NOT NULL CHECK (gst_type IN ('none', 'intra', 'inter')),
      cgst_paise INTEGER NOT NULL DEFAULT 0,
      sgst_paise INTEGER NOT NULL DEFAULT 0,
      igst_paise INTEGER NOT NULL DEFAULT 0,
      total_paise INTEGER NOT NULL CHECK (total_paise > 0),
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled')),
      checkout_session_id TEXT,
      checkout_url TEXT,
      payment_intent_id TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO invoices_migrated SELECT * FROM invoices;
    DROP TABLE invoices;
    ALTER TABLE invoices_migrated RENAME TO invoices;
    CREATE INDEX invoices_created_at_idx ON invoices (created_at DESC);
    CREATE INDEX invoices_lead_created_at_idx ON invoices (lead_reference_id, created_at DESC);
    COMMIT;
  `);
}

const leadColumns = new Set(
  database
    .prepare('PRAGMA table_info(leads)')
    .all()
    .map((column) => column.name),
);
if (!leadColumns.has('source_page')) {
  database.exec("ALTER TABLE leads ADD COLUMN source_page TEXT NOT NULL DEFAULT '/'");
}

const mapLead = (row) => {
  if (!row) return null;

  return {
    id: row.reference_id,
    referenceId: row.reference_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    service: row.service,
    budget: row.budget,
    timeline: row.timeline,
    message: row.message,
    status: row.status,
    sourcePage: row.source_page,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const normalizeStatus = (status = 'new') => {
  const normalized = String(status || 'new')
    .trim()
    .toLowerCase();
  return validStatuses.includes(normalized) ? normalized : 'new';
};

const findLeadById = (identifier) => {
  if (!identifier) return null;

  const row = database
    .prepare(
      `
    SELECT * FROM leads
    WHERE reference_id = ?
  `,
    )
    .get(identifier);

  return mapLead(row);
};

const addLead = (leadInput = {}) => {
  const now = new Date().toISOString();
  const referenceId = leadInput.referenceId || leadInput.id || `VL-${randomUUID().toUpperCase()}`;
  const createdAt = leadInput.createdAt || now;
  const updatedAt = leadInput.updatedAt || createdAt;

  database
    .prepare(
      `
    INSERT INTO leads (
      reference_id, name, email, phone, company, service, budget, timeline,
      message, status, source_page, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      referenceId,
      String(leadInput.name || '').trim(),
      String(leadInput.email || '').trim(),
      leadInput.phone || null,
      leadInput.company || null,
      leadInput.service || null,
      leadInput.budget || null,
      leadInput.timeline || null,
      String(leadInput.message || '').trim(),
      normalizeStatus(leadInput.status),
      leadInput.sourcePage || '/',
      createdAt,
      updatedAt,
    );

  return findLeadById(referenceId);
};

const listLeads = ({ status, search = '', limit = 25, offset = 0 } = {}) => {
  const filters = [];
  const parameters = [];

  if (status) {
    filters.push('status = ?');
    parameters.push(normalizeStatus(status));
  }

  if (search) {
    filters.push(`(
      instr(lower(name), lower(?)) > 0 OR
      instr(lower(email), lower(?)) > 0 OR
      instr(lower(company), lower(?)) > 0 OR
      instr(lower(message), lower(?)) > 0
    )`);
    parameters.push(search, search, search, search);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = database
    .prepare(`SELECT COUNT(*) AS total FROM leads ${where}`)
    .get(...parameters).total;
  const rows = database
    .prepare(
      `
    SELECT * FROM leads ${where}
    ORDER BY created_at DESC, reference_id DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...parameters, limit, offset);

  return {
    total,
    items: rows.map(mapLead),
  };
};

const getStats = () => {
  const totals = Object.fromEntries(validStatuses.map((status) => [status, 0]));
  const rows = database
    .prepare(
      `
    SELECT status, COUNT(*) AS count
    FROM leads
    GROUP BY status
  `,
    )
    .all();

  for (const row of rows) totals[row.status] = row.count;

  const monthlyCounts = database
    .prepare(
      `
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
    FROM leads
    WHERE created_at >= ?
    GROUP BY month
  `,
    )
    .all(
      `${new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)).toISOString().slice(0, 10)}`,
    );
  const monthlyByMonth = new Map(monthlyCounts.map((row) => [row.month, row.count]));
  const now = new Date();
  const monthlyEnquiries = Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
    const month = monthDate.toISOString().slice(0, 7);
    return { month, count: monthlyByMonth.get(month) || 0 };
  });

  return {
    total: Object.values(totals).reduce((sum, count) => sum + count, 0),
    ...totals,
    monthlyEnquiries,
  };
};

const listFollowUpNotes = (identifier) =>
  database
    .prepare(
      `
  SELECT id, note, created_at AS createdAt
  FROM follow_up_notes
  WHERE lead_reference_id = ?
  ORDER BY created_at DESC, id DESC
`,
    )
    .all(identifier);

const addFollowUpNote = (identifier, note) => {
  const createdAt = new Date().toISOString();
  const result = database
    .prepare(
      `
    INSERT INTO follow_up_notes (lead_reference_id, note, created_at)
    VALUES (?, ?, ?)
  `,
    )
    .run(identifier, note, createdAt);
  return database
    .prepare(
      `
    SELECT id, note, created_at AS createdAt
    FROM follow_up_notes
    WHERE id = ?
  `,
    )
    .get(result.lastInsertRowid);
};

const updateLeadStatus = (identifier, nextStatus) => {
  const normalizedStatus = normalizeStatus(nextStatus);
  const result = database
    .prepare(
      `
    UPDATE leads
    SET status = ?, updated_at = ?
    WHERE reference_id = ?
  `,
    )
    .run(normalizedStatus, new Date().toISOString(), identifier);

  return result.changes ? findLeadById(identifier) : null;
};

const mapInvoice = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    leadReferenceId: row.lead_reference_id,
    sellerName: row.seller_name,
    sellerGstin: row.seller_gstin,
    sellerAddress: row.seller_address,
    sellerState: row.seller_state,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientGstin: row.client_gstin,
    billingAddress: row.billing_address,
    placeOfSupplyState: row.place_of_supply_state,
    description: row.description,
    subtotalPaise: row.subtotal_paise,
    gstRate: row.gst_rate,
    gstType: row.gst_type,
    cgstPaise: row.cgst_paise,
    sgstPaise: row.sgst_paise,
    igstPaise: row.igst_paise,
    totalPaise: row.total_paise,
    dueDate: row.due_date,
    status: row.status,
    paymentIntentId: row.payment_intent_id,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const createInvoice = (input, seller) => {
  const id = randomUUID();
  const token = deriveInvoiceToken(id);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date().toISOString();
  const dateCode = now.slice(0, 10).replace(/-/g, '');
  const prefix = `VL-${dateCode}-`;
  const gstPaise = seller.gstRegistered ? Math.round((input.subtotalPaise * 18) / 100) : 0;
  const gstType = !seller.gstRegistered
    ? 'none'
    : seller.state.trim().toLowerCase() === input.placeOfSupplyState.trim().toLowerCase()
      ? 'intra'
      : 'inter';
  const cgstPaise = gstType === 'intra' ? Math.floor(gstPaise / 2) : 0;
  const sgstPaise = gstType === 'intra' ? gstPaise - cgstPaise : 0;
  const igstPaise = gstType === 'inter' ? gstPaise : 0;

  database.exec('BEGIN IMMEDIATE');
  try {
    const latest = database
      .prepare(
        `
      SELECT invoice_number FROM invoices
      WHERE invoice_number LIKE ?
      ORDER BY invoice_number DESC
      LIMIT 1
    `,
      )
      .get(`${prefix}%`);
    const sequence = latest ? Number(latest.invoice_number.slice(prefix.length)) + 1 : 1;
    const invoiceNumber = `${prefix}${String(sequence).padStart(4, '0')}`;

    database
      .prepare(
        `
      INSERT INTO invoices (
        id, invoice_number, public_token_hash, lead_reference_id,
        seller_name, seller_gstin, seller_address, seller_state,
        client_name, client_email, client_gstin, billing_address, place_of_supply_state,
        description, subtotal_paise, gst_rate, gst_type, cgst_paise, sgst_paise,
        igst_paise, total_paise, due_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        invoiceNumber,
        tokenHash,
        input.leadReferenceId || null,
        seller.name,
        seller.gstin,
        seller.address,
        seller.state,
        input.clientName,
        input.clientEmail,
        input.clientGstin || null,
        input.billingAddress,
        input.placeOfSupplyState,
        input.description,
        input.subtotalPaise,
        seller.gstRegistered ? 18 : 0,
        gstType,
        cgstPaise,
        sgstPaise,
        igstPaise,
        input.subtotalPaise + gstPaise,
        input.dueDate,
        now,
        now,
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  const row = database.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  return { invoice: mapInvoice(row), token };
};

const findInvoiceByToken = (token) => {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return mapInvoice(
    database
      .prepare(
        `
    SELECT * FROM invoices WHERE public_token_hash = ?
  `,
      )
      .get(tokenHash),
  );
};

const listInvoices = (limit = 50) =>
  database
    .prepare(
      `
  SELECT * FROM invoices
  ORDER BY created_at DESC, invoice_number DESC
  LIMIT ?
`,
    )
    .all(limit)
    .map(mapInvoice);

const listInvoicesForLead = (leadReferenceId) =>
  database
    .prepare(
      `
  SELECT * FROM invoices
  WHERE lead_reference_id = ?
  ORDER BY created_at DESC, invoice_number DESC
`,
    )
    .all(leadReferenceId)
    .map(mapInvoice);

const saveInvoiceCheckout = (invoiceId, sessionId, checkoutUrl) => {
  database
    .prepare(
      `
    UPDATE invoices
    SET checkout_session_id = ?, checkout_url = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `,
    )
    .run(sessionId, checkoutUrl, new Date().toISOString(), invoiceId);
};

const getInvoiceCheckout = (invoiceId) =>
  database
    .prepare(
      `
  SELECT checkout_session_id AS sessionId, checkout_url AS checkoutUrl
  FROM invoices
  WHERE id = ? AND status = 'pending'
`,
    )
    .get(invoiceId) || null;

const markInvoicePaid = (invoiceNumber, sessionId, paymentIntentId, paidAt, amountPaise) => {
  const result = database
    .prepare(
      `
    UPDATE invoices
    SET status = 'paid', payment_intent_id = ?, paid_at = ?, updated_at = ?, checkout_session_id = ?
    WHERE invoice_number = ? AND total_paise = ? AND
      (checkout_session_id IS NULL OR checkout_session_id = ?) AND status = 'pending'
  `,
    )
    .run(
      paymentIntentId || null,
      paidAt || new Date().toISOString(),
      new Date().toISOString(),
      sessionId,
      invoiceNumber,
      amountPaise,
      sessionId,
    );
  return result.changes > 0;
};

const checkDatabase = () => {
  database.prepare('SELECT 1').get();
};

module.exports = {
  addLead,
  listLeads,
  getStats,
  findLeadById,
  listFollowUpNotes,
  addFollowUpNote,
  updateLeadStatus,
  createInvoice,
  findInvoiceByToken,
  listInvoices,
  listInvoicesForLead,
  saveInvoiceCheckout,
  getInvoiceCheckout,
  markInvoicePaid,
  deriveInvoiceToken,
  checkDatabase,
  validStatuses,
};
