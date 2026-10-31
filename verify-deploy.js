const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const requiredPublicFiles = [
  'index.html',
  'web-development.html',
  'ai-ml.html',
  'cloud-devops.html',
  'mobile-apps.html',
  'software-integrations.html',
  'ui-ux-design.html',
  'digital-solutions.html',
  'service.css',
  'invoice.html',
  'invoice.css',
  'invoice.js',
  'robots.txt',
  'sitemap.xml',
  'admin.html',
  'admin.css',
  'admin.js',
  'VashodiyaLabs.css',
  'VashodiyaLabs.js',
  'config.js',
  'privacy.html',
  'terms.html',
  'thank-you.html',
];
const javaScriptFiles = [
  'server.js',
  'scripts/backup-database.js',
  'public/VashodiyaLabs.js',
  'public/admin.js',
  'routes/contact.js',
  'routes/admin.js',
  'routes/api.js',
  'routes/invoices.js',
  'data/leadStore.js',
  'services/invoices.js',
  'services/stripePayments.js',
  'services/invoiceNotifications.js',
  'services/emailNotifications.js',
  'middleware/adminAuth.js',
  'netlify/functions/api-proxy.js',
];

for (const file of requiredPublicFiles) {
  if (!fs.existsSync(path.join(publicDir, file))) {
    throw new Error(`Missing Netlify publish file: public/${file}`);
  }
}

const privatePublishEntry =
  /^(?:\.env(?:\..*)?|server\.js|package(?:-lock)?\.json|render\.ya?ml|netlify\.toml|\.gitignore|routes|middleware|services|data|netlify|node_modules|scripts)$/i;
for (const entry of fs.readdirSync(publicDir)) {
  if (privatePublishEntry.test(entry)) {
    throw new Error(`Private or backend file must not be published: public/${entry}`);
  }
}

const publicHtmlFiles = fs.readdirSync(publicDir).filter((file) => file.endsWith('.html'));
for (const htmlFile of publicHtmlFiles) {
  const html = fs.readFileSync(path.join(publicDir, htmlFile), 'utf8');
  const assetTags = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
    ...html.matchAll(
      /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
    ),
  ];
  const scriptPaths = new Set();

  for (const [tag, reference] of assetTags) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) continue;

    const relativePath = reference.split(/[?#]/, 1)[0].replace(/^\/+/, '');
    const assetPath = path.resolve(publicDir, relativePath);
    if (!assetPath.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(assetPath)) {
      throw new Error(`${htmlFile} references a missing or unsafe asset: ${reference}`);
    }

    if (tag.startsWith('<script')) {
      if (scriptPaths.has(relativePath)) {
        throw new Error(`${htmlFile} loads the same JavaScript file more than once: ${reference}`);
      }
      scriptPaths.add(relativePath);
    }
  }
}

for (const file of javaScriptFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(
  'Deploy check passed: static pages, assets, private-file boundary, and JavaScript syntax.',
);
