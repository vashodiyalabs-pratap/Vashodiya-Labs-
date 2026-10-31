const loginPanel = document.getElementById('loginPanel');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const dashboard = document.getElementById('dashboard');
const dashboardMessage = document.getElementById('dashboardMessage');
const logoutButton = document.getElementById('logoutButton');
const statsGrid = document.getElementById('statsGrid');
const monthlyChart = document.getElementById('monthlyChart');
const monthlyTotal = document.getElementById('monthlyTotal');
const leadList = document.getElementById('leadList');
const leadCount = document.getElementById('leadCount');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const previousPage = document.getElementById('previousPage');
const nextPage = document.getElementById('nextPage');
const pageLabel = document.getElementById('pageLabel');
const refreshButton = document.getElementById('refreshButton');
const emptyDetail = document.getElementById('emptyDetail');
const detailView = document.getElementById('detailView');
const clientName = document.getElementById('clientName');
const referenceId = document.getElementById('referenceId');
const currentStatus = document.getElementById('currentStatus');
const clientFields = document.getElementById('clientFields');
const detailStatus = document.getElementById('detailStatus');
const noteForm = document.getElementById('noteForm');
const noteInput = document.getElementById('noteInput');
const noteMessage = document.getElementById('noteMessage');
const notesList = document.getElementById('notesList');
const invoiceForm = document.getElementById('invoiceForm');
const invoiceMessage = document.getElementById('invoiceMessage');
const invoiceList = document.getElementById('invoiceList');
const shareInvoice = document.getElementById('shareInvoice');
const invoiceClientLink = document.getElementById('invoiceClientLink');
const copyInvoiceLink = document.getElementById('copyInvoiceLink');

const pageSize = 25;
const statusLabels = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  in_progress: 'In progress',
  closed: 'Closed',
};
const state = { page: 1, totalPages: 1, total: 0, selected: null, searchTimer: null };

function apiBase() {
  return (window.VASHODIYA_CONFIG?.apiBaseUrl || window.location.origin).replace(/\/+$/, '');
}

function setMessage(target, message, type = '') {
  target.textContent = message;
  if (type) target.dataset.state = type;
  else delete target.dataset.state;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function formatDate(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatMoney(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

function displayStatus(status) {
  return statusLabels[status] || status;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase()}/api/admin${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${sessionStorage.getItem('vashodiyaAdminKey') || ''}`,
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    const error = new Error(
      result?.message || `The admin service returned an error (${response.status}).`,
    );
    error.status = response.status;
    throw error;
  }
  return result.data;
}

function showSignedOut(message = '') {
  sessionStorage.removeItem('vashodiyaAdminKey');
  dashboard.hidden = true;
  loginPanel.hidden = false;
  logoutButton.hidden = true;
  if (message) setMessage(loginMessage, message, 'error');
  document.getElementById('adminKey').focus();
}

function renderStats(summary) {
  const cards = [
    { label: 'Total enquiries', value: summary.total, primary: true },
    { label: 'New enquiries', value: summary.new },
    { label: 'In progress', value: summary.in_progress },
    { label: 'Closed', value: summary.closed },
  ];
  statsGrid.replaceChildren(
    ...cards.map((card) => {
      const element = makeElement('article', `stat-card${card.primary ? ' primary' : ''}`);
      element.append(makeElement('span', '', card.label), makeElement('strong', '', card.value));
      return element;
    }),
  );

  const months = summary.monthlyEnquiries || [];
  const maxCount = Math.max(1, ...months.map((month) => month.count));
  monthlyTotal.textContent = `${months.reduce((sum, month) => sum + month.count, 0)} total`;
  monthlyChart.replaceChildren(
    ...months.map(({ month, count }) => {
      const column = makeElement('div', 'month-column');
      const date = new Date(`${month}-01T12:00:00Z`);
      const label = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
      const value = makeElement('span', 'month-value', count || '');
      const track = makeElement('span', 'month-track');
      const bar = makeElement('span', 'month-bar');
      bar.style.height = `${count ? Math.max(5, (count / maxCount) * 100) : 0}%`;
      track.append(bar);
      column.append(value, track, makeElement('span', 'month-label', label));
      column.setAttribute('aria-label', `${label}: ${count} enquiries`);
      column.title = `${label}: ${count} enquiries`;
      return column;
    }),
  );
}

function makeStatusBadge(status) {
  const badge = makeElement('span', 'status-badge', displayStatus(status));
  badge.dataset.status = status;
  return badge;
}

function renderLeadList(items) {
  leadList.replaceChildren();
  if (!items.length) {
    leadList.append(makeElement('p', 'empty-notes', 'No enquiries match your search.'));
    leadList.firstElementChild.style.padding = '24px 18px';
    return;
  }

  for (const lead of items) {
    const button = makeElement('button', 'lead-row');
    button.type = 'button';
    button.dataset.referenceId = lead.referenceId;
    button.setAttribute('aria-current', String(state.selected?.referenceId === lead.referenceId));
    const top = makeElement('span', 'lead-row-top');
    top.append(makeElement('strong', 'lead-name', lead.name), makeStatusBadge(lead.status));
    const meta = makeElement('span', 'lead-meta');
    meta.append(
      makeElement('span', '', lead.company || lead.service),
      makeElement('span', '', formatDate(lead.createdAt, { dateStyle: 'medium' })),
    );
    button.append(top, makeElement('span', 'lead-email', lead.email), meta);
    button.addEventListener('click', () => selectLead(lead.referenceId));
    leadList.append(button);
  }
}

async function loadSummary() {
  const summary = await request('/summary');
  renderStats(summary);
}

async function loadLeads() {
  const params = new URLSearchParams({ page: String(state.page), limit: String(pageSize) });
  const search = searchInput.value.trim();
  if (search) params.set('search', search);
  if (statusFilter.value) params.set('status', statusFilter.value);

  const data = await request(`/leads?${params}`);
  state.total = data.total;
  state.totalPages = Math.max(1, data.pagination.totalPages);
  leadCount.textContent = `${data.total} ${data.total === 1 ? 'enquiry' : 'enquiries'}`;
  pageLabel.textContent = `Page ${state.page} of ${state.totalPages}`;
  previousPage.disabled = state.page <= 1;
  nextPage.disabled = state.page >= state.totalPages;
  renderLeadList(data.items);

  if (
    state.selected &&
    data.items.some((lead) => lead.referenceId === state.selected.referenceId)
  ) {
    state.selected = data.items.find((lead) => lead.referenceId === state.selected.referenceId);
  }
}

function addDetailField(label, value, { full = false, email = false } = {}) {
  const field = makeElement('dl', `detail-field${full ? ' full' : ''}`);
  field.append(makeElement('dt', '', label));
  const content = makeElement('dd');
  if (email && value) {
    const link = makeElement('a', '', value);
    link.href = `mailto:${value}`;
    content.append(link);
  } else {
    content.textContent = value || '—';
  }
  field.append(content);
  clientFields.append(field);
}

function renderLeadDetails(lead) {
  emptyDetail.hidden = true;
  detailView.hidden = false;
  clientName.textContent = lead.name;
  referenceId.textContent = lead.referenceId;
  currentStatus.textContent = displayStatus(lead.status);
  currentStatus.dataset.status = lead.status;
  detailStatus.value = lead.status;
  clientFields.replaceChildren();
  addDetailField('Email', lead.email, { email: true });
  addDetailField('Phone', lead.phone);
  addDetailField('Company', lead.company);
  addDetailField('Service', lead.service);
  addDetailField('Budget', lead.budget);
  addDetailField('Timeline', lead.timeline);
  addDetailField('Source page', lead.sourcePage);
  addDetailField('Received', formatDate(lead.createdAt));
  addDetailField('Project details', lead.message, { full: true });
}

function renderNotes(notes) {
  notesList.replaceChildren();
  if (!notes.length) {
    notesList.append(makeElement('li', 'empty-notes', 'No follow-up notes yet.'));
    return;
  }

  for (const note of notes) {
    const item = makeElement('li', 'note-item');
    item.append(makeElement('p', '', note.note));
    const time = makeElement('time', '', formatDate(note.createdAt));
    time.dateTime = note.createdAt;
    item.append(time);
    notesList.append(item);
  }
}

async function selectLead(identifier) {
  try {
    const lead = await request(`/leads/${encodeURIComponent(identifier)}`);
    state.selected = lead;
    renderLeadDetails(lead);
    setMessage(dashboardMessage, '');
    const notes = await request(`/leads/${encodeURIComponent(identifier)}/notes`);
    renderNotes(notes);
    document.getElementById('invoiceClientName').value = lead.company || lead.name;
    document.getElementById('invoiceClientEmail').value = lead.email;
    document.getElementById('invoiceDescription').value = lead.service;
    shareInvoice.hidden = true;
    setMessage(invoiceMessage, '');
    await loadLeadInvoices(identifier);
    leadList.querySelectorAll('.lead-row').forEach((row) => {
      row.setAttribute('aria-current', String(row.dataset.referenceId === lead.referenceId));
    });
    setMessage(noteMessage, '');
  } catch (error) {
    if (error.status === 401) return showSignedOut('Your admin session expired. Sign in again.');
    setMessage(dashboardMessage, error.message, 'error');
  }
}

function renderInvoices(invoices) {
  invoiceList.replaceChildren();
  if (!invoices.length) {
    invoiceList.append(
      makeElement('li', 'empty-notes', 'No invoices created for this client yet.'),
    );
    return;
  }

  for (const invoice of invoices) {
    const item = makeElement('li', 'invoice-item');
    const details = makeElement('div', 'invoice-item-main');
    details.append(
      makeElement('strong', '', invoice.invoiceNumber),
      makeElement(
        'small',
        '',
        `${formatMoney(invoice.totalPaise)} · Due ${formatDate(invoice.dueDate, { dateStyle: 'medium' })}`,
      ),
    );
    const badge = makeElement('span', 'invoice-status', invoice.status);
    badge.dataset.status = invoice.status;
    const link = makeElement('a', '', invoice.clientUrl);
    link.href = invoice.clientUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(details, badge, link);
    invoiceList.append(item);
  }
}

async function loadLeadInvoices(identifier) {
  try {
    const invoices = await request(`/invoices/lead/${encodeURIComponent(identifier)}`);
    renderInvoices(invoices);
  } catch (error) {
    if (error.status === 401) {
      showSignedOut('Your admin session expired. Sign in again.');
      return;
    }
    setMessage(invoiceMessage, error.message, 'error');
  }
}

async function refreshDashboard() {
  setMessage(dashboardMessage, '');
  try {
    await Promise.all([loadSummary(), loadLeads()]);
    if (state.selected) {
      const updated = await request(`/leads/${encodeURIComponent(state.selected.referenceId)}`);
      state.selected = updated;
      renderLeadDetails(updated);
    }
  } catch (error) {
    if (error.status === 401) return showSignedOut('Your admin session expired. Sign in again.');
    setMessage(dashboardMessage, error.message, 'error');
  }
}

async function openDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  logoutButton.hidden = false;
  setMessage(loginMessage, '');
  await refreshDashboard();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const keyInput = document.getElementById('adminKey');
  sessionStorage.setItem('vashodiyaAdminKey', keyInput.value.trim());
  keyInput.value = '';
  const submit = loginForm.querySelector("button[type='submit']");
  submit.disabled = true;
  setMessage(loginMessage, 'Checking your admin key…');
  try {
    await request('/summary');
    await openDashboard();
  } catch (error) {
    sessionStorage.removeItem('vashodiyaAdminKey');
    setMessage(loginMessage, error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

logoutButton.addEventListener('click', () => {
  state.selected = null;
  showSignedOut('You have signed out.');
});

refreshButton.addEventListener('click', refreshDashboard);
statusFilter.addEventListener('change', () => {
  state.page = 1;
  loadLeads().catch((error) => setMessage(dashboardMessage, error.message, 'error'));
});
searchInput.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.page = 1;
    loadLeads().catch((error) => setMessage(dashboardMessage, error.message, 'error'));
  }, 250);
});
previousPage.addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page -= 1;
  loadLeads().catch((error) => setMessage(dashboardMessage, error.message, 'error'));
});
nextPage.addEventListener('click', () => {
  if (state.page >= state.totalPages) return;
  state.page += 1;
  loadLeads().catch((error) => setMessage(dashboardMessage, error.message, 'error'));
});

detailStatus.addEventListener('change', async () => {
  if (!state.selected) return;
  detailStatus.disabled = true;
  try {
    const result = await request(
      `/leads/${encodeURIComponent(state.selected.referenceId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: detailStatus.value }),
      },
    );
    state.selected = result;
    renderLeadDetails(result);
    await Promise.all([loadSummary(), loadLeads()]);
    setMessage(dashboardMessage, 'Lead status updated.', 'success');
  } catch (error) {
    if (error.status === 401) showSignedOut('Your admin session expired. Sign in again.');
    else {
      detailStatus.value = state.selected.status;
      setMessage(dashboardMessage, error.message, 'error');
    }
  } finally {
    detailStatus.disabled = false;
  }
});

noteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selected || !noteInput.value.trim()) return;
  const submit = noteForm.querySelector("button[type='submit']");
  submit.disabled = true;
  setMessage(noteMessage, '');
  try {
    await request(`/leads/${encodeURIComponent(state.selected.referenceId)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note: noteInput.value.trim() }),
    });
    noteInput.value = '';
    renderNotes(await request(`/leads/${encodeURIComponent(state.selected.referenceId)}/notes`));
    setMessage(noteMessage, 'Follow-up note saved.', 'success');
  } catch (error) {
    if (error.status === 401) showSignedOut('Your admin session expired. Sign in again.');
    else setMessage(noteMessage, error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

const dueDateInput = document.getElementById('invoiceDueDate');
const defaultDueDate = new Date();
defaultDueDate.setDate(defaultDueDate.getDate() + 14);
dueDateInput.value = defaultDueDate.toISOString().slice(0, 10);

invoiceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selected) {
    setMessage(invoiceMessage, 'Select a client enquiry before creating an invoice.', 'error');
    return;
  }

  const submit = invoiceForm.querySelector("button[type='submit']");
  submit.disabled = true;
  shareInvoice.hidden = true;
  setMessage(invoiceMessage, 'Creating invoice…');
  try {
    const result = await request('/invoices', {
      method: 'POST',
      body: JSON.stringify({
        leadReferenceId: state.selected.referenceId,
        clientName: document.getElementById('invoiceClientName').value.trim(),
        clientEmail: document.getElementById('invoiceClientEmail').value.trim(),
        clientGstin: document.getElementById('invoiceClientGstin').value.trim().toUpperCase(),
        billingAddress: document.getElementById('invoiceBillingAddress').value.trim(),
        placeOfSupplyState: document.getElementById('invoicePlaceOfSupply').value.trim(),
        description: document.getElementById('invoiceDescription').value.trim(),
        subtotal: document.getElementById('invoiceSubtotal').value,
        dueDate: dueDateInput.value,
      }),
    });
    invoiceClientLink.value = result.clientUrl;
    shareInvoice.hidden = false;
    setMessage(
      invoiceMessage,
      result.notificationSent
        ? `${result.invoice.invoiceNumber} created and emailed to ${result.invoice.clientEmail}.`
        : `${result.invoice.invoiceNumber} created. ${result.message} Copy the secure link below and share it with your client.`,
      result.notificationSent ? 'success' : 'error',
    );
    document.getElementById('invoiceSubtotal').value = '';
    await loadLeadInvoices(state.selected.referenceId);
  } catch (error) {
    if (error.status === 401) showSignedOut('Your admin session expired. Sign in again.');
    else setMessage(invoiceMessage, error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

copyInvoiceLink.addEventListener('click', async () => {
  invoiceClientLink.select();
  try {
    await navigator.clipboard.writeText(invoiceClientLink.value);
    setMessage(invoiceMessage, 'Private invoice link copied.', 'success');
  } catch (error) {
    console.error('Could not copy invoice link to clipboard:', error);
    setMessage(invoiceMessage, 'Select and copy the invoice link from the field above.', 'error');
  }
});

if (sessionStorage.getItem('vashodiyaAdminKey')) {
  openDashboard();
}
