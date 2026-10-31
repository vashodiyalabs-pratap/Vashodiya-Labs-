const express = require('express');
const path = require('path');
const { spawn } = require('node:child_process');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const contactRoutes = require('./routes/contact');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const invoiceRoutes = require('./routes/invoices');
const { adminAuthLimiter, requireAdminKey } = require('./middleware/adminAuth');
const { handleStripeWebhook } = require('./services/stripePayments');

const app = express();
const PORT = process.env.PORT || 5000;
const backupIntervalHours = Number(process.env.DATABASE_BACKUP_INTERVAL_HOURS || 0);
if (!Number.isSafeInteger(backupIntervalHours) || backupIntervalHours < 0) {
  throw new Error('DATABASE_BACKUP_INTERVAL_HOURS must be zero or a positive whole number.');
}
const allowedOrigins = (
  process.env.CORS_ORIGINS || 'https://vashodiyalabs.netlify.app,http://localhost:5000'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: allowedOrigins }));
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json', limit: '64kb' }),
  handleStripeWebhook,
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/contact', contactRoutes);
app.use('/api/admin/invoices', adminAuthLimiter, requireAdminKey, invoiceRoutes.adminRouter);
app.use('/api/admin', adminAuthLimiter, requireAdminKey, adminRoutes);
app.use('/api/invoices', invoiceRoutes.publicRouter);
app.use('/api', apiRoutes);
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found.',
  });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/invoice/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'invoice.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.get('/thank-you', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

const servicePages = [
  'web-development',
  'ai-ml',
  'cloud-devops',
  'mobile-apps',
  'software-integrations',
  'ui-ux-design',
  'digital-solutions',
];
for (const page of servicePages) {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON payload. Please check your request body.',
    });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Request body is too large.',
    });
  }

  console.error('[SERVER ERROR]:', err.stack);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);

  if (backupIntervalHours > 0) {
    const createBackup = () => {
      const backup = spawn(
        process.execPath,
        [path.join(__dirname, 'scripts', 'backup-database.js')],
        {
          stdio: 'inherit',
          env: process.env,
        },
      );
      let spawnError = false;
      backup.once('error', (error) => {
        spawnError = true;
        console.error('[DATABASE BACKUP FAILED]:', error.message);
      });
      backup.once('exit', (code, signal) => {
        if (!spawnError && code !== 0) {
          console.error('[DATABASE BACKUP FAILED]:', signal || `exit code ${code}`);
        }
      });
    };

    createBackup();
    const backupTimer = setInterval(createBackup, backupIntervalHours * 60 * 60 * 1000);
    backupTimer.unref();
  }
});
