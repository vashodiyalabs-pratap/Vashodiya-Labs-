# Vashodiya Labs

Public website and Express API for Vashodiya Labs project inquiries.

## Project layout

- `public/` contains the deployable website pages and browser assets. It is the Netlify publish directory and the folder Express serves locally.
- `netlify/functions/` contains Netlify serverless functions; `api-proxy.js` forwards public API requests to the separately hosted backend.
- `routes/`, `middleware/`, `services/`, and `data/` contain the Express API, request controls, notification integration, and SQLite lead store.
- `scripts/verify-deploy.js` checks required publish files, local page assets, the public/private file boundary, and JavaScript syntax before deployment. `tests/backend.test.js` runs API integration tests against a temporary database.
- `server.js`, `package.json`, and `render.yaml` configure the local/Render backend. Environment secrets belong in hosting settings or a local `.env`, never in `public/`.

## Requirements

- Node.js 22.13 or newer (the backend uses Node's built-in SQLite API).
- npm.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set a long, random `ADMIN_API_KEY` in `.env`. Keep it private; never put it in the public website configuration.
3. Set `CORS_ORIGINS` to the exact comma-separated website origins allowed to call the API.
4. Optionally set `DATABASE_PATH` to a writable persistent path. The default is `data/leads.sqlite`.
5. Set the public contact options and optional Google Analytics measurement ID in `public/config.js`. Leave values blank to hide those integrations until configured.
6. Install the locked dependencies with `npm ci`.
7. Start the server with `npm start` (or `npm run dev` while developing).
8. Open `http://localhost:5000`.
9. Run `npm run check` to validate deployment files and `npm test` to test inquiry persistence, validation, API errors, and admin access.

The SQLite file and its WAL files are ignored by Git. The backend creates the database and `leads` table on startup.

## Deploy Netlify frontend and Express backend

Netlify's static hosting does not run `server.js`. Deploy the Express backend separately:

1. Deploy this repository to Render using `render.yaml`. The blueprint creates a Node service and mounts a persistent disk for the SQLite file. Render installs the locked production dependencies with `npm ci --omit=dev`.
2. Wait until Render reports `/api/health` healthy. In the Render service environment, set `CORS_ORIGINS` to the exact site origins that need direct browser access. Keep the generated `ADMIN_API_KEY` private.
3. In Netlify site environment variables, set `BACKEND_API_URL` to the Render service origin (for example, `https://your-render-service.onrender.com`, with no path). Make it available to Functions at runtime, then trigger a new deploy so the API proxy can reach it. Do not put this value in browser JavaScript if it contains anything private; the API proxy keeps the backend URL server-side.
4. Set `RESEND_API_KEY`, `ENQUIRY_NOTIFY_EMAIL`, and `EMAIL_FROM` on Render to enable inquiry email notifications. Resend requires an authorized sender address/domain. The lead is written to SQLite before notification is attempted; a notification error is logged without discarding the lead.
5. Submit a test inquiry on the live site, confirm the chat displays its saved reference ID (or the contact form reaches the thank-you page), check the notification inbox, and verify the lead using the protected admin API.
6. Configure the WhatsApp number, public email, optional HTTPS booking URL, and (if desired) GA4 measurement ID in `public/config.js`, then redeploy Netlify. Analytics loads only after visitors consent.
7. To issue invoices, configure `INVOICE_SELLER_NAME`, `INVOICE_SELLER_ADDRESS`, and `INVOICE_SELLER_STATE` on Render. Set `INVOICE_GST_REGISTERED=false` for a seller not registered for GST; this issues a regular invoice with no GST. Only registered sellers should set it to `true` and provide a valid `INVOICE_SELLER_GSTIN`. Keep the generated `INVOICE_TOKEN_SECRET` unchanged so previously issued invoice links continue working. Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on Render; use Stripe test-mode keys first.
8. In Stripe Workbench, register a webhook at `https://vashodiyalabs.netlify.app/api/stripe/webhook` (or the matching public-site origin) and subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Netlify forwards the signed webhook to Render. Do not configure a Stripe webhook using the frontend URL unless the `/api/*` proxy is deployed and `BACKEND_API_URL` is working.

The Netlify `/api/*` rewrite forwards requests to a serverless proxy, which calls the separately hosted Express API. Netlify runs `npm run build` to validate the publish files, JavaScript syntax, and function entry point before publishing `public/`. If `BACKEND_API_URL` is missing, the proxy returns a clear `503` rather than silently treating a static-site `404` as an inquiry response.

## Inquiry API

- `GET /api/health` — API and SQLite readiness.
- `POST /api/contact` — validates, rate-limits, and stores an inquiry; returns its reference ID.
- `GET /api/admin/summary` — lead totals by status; requires `Authorization: Bearer <ADMIN_API_KEY>`.
- `GET /api/admin/leads?page=1&limit=25&status=new&search=term` — search and paginate leads; requires the admin bearer key. `limit` is capped at 100.
- `GET /api/admin/leads/:identifier` — retrieve a lead; requires the admin bearer key.
- `PATCH /api/admin/leads/:identifier/status` — update lead status; requires the admin bearer key.
- `GET /api/admin/leads/:identifier/notes` and `POST /api/admin/leads/:identifier/notes` — list or add private follow-up notes; requires the admin bearer key.
- `POST /api/admin/invoices` — validate and issue an INR GST invoice for a client; requires the admin bearer key.
- `GET /api/admin/invoices` and `GET /api/admin/invoices/lead/:referenceId` — list invoices and recover their private share links; requires the admin bearer key.
- `GET /api/invoices/:token` and `POST /api/invoices/:token/checkout` — view a token-protected invoice or start Stripe Checkout.
- `POST /api/stripe/webhook` — verifies Stripe's signed event and records payment only when the session amount and currency match the invoice.

Open `/admin` on the website to use the private dashboard. Enter the Render `ADMIN_API_KEY` when prompted; it is held in session storage for the current browser tab and is never embedded in the public site. The dashboard shows lead totals, the last 12 months of enquiries, searchable and filterable leads, client details, status updates, and persistent follow-up notes. Its static page is publicly hosted, but all lead and note data remains behind the protected admin API.

The homepage's Let's Talk conversation and the contact form both submit to `POST /api/contact` and are stored in the same SQLite database. The conversation gathers the service, name, email, and project details one question at a time; it submits automatically after the final answer, without a separate "Send inquiry" action button. Each lead records only the page path it came from. The contact form includes a honeypot and is limited to five submissions per IP every 15 minutes. The admin API limits unsuccessful key attempts to ten per IP every 15 minutes.

### Invoices and Stripe payments

In `/admin`, select a client enquiry and use **Invoices & payments** to issue an invoice. The server requires the seller's legal name, address, state, public website origin, a stable `INVOICE_TOKEN_SECRET`, and Stripe configuration. For a GST-registered seller, set `INVOICE_GST_REGISTERED=true` and provide a valid GSTIN; the server calculates 18% GST (CGST + SGST for the same state, otherwise IGST). For a seller not registered for GST, set `INVOICE_GST_REGISTERED=false`; invoices carry no GST and do not require a place-of-supply state. The form collects client billing details, service description, amount in INR, and due date. This tool does not file GST returns or generate an e-invoice IRN; confirm applicable tax treatment with a qualified tax professional.

The invoice is saved in SQLite with a sequential daily invoice number and a signed, unguessable client URL; only its token hash is stored. Admins can recover the URL from the authenticated invoice list. If Resend is configured, creating an invoice emails its private link to the client; otherwise the invoice is still saved and the admin dashboard clearly exposes the link for manual sharing. Client cards go to Stripe Checkout in INR (Stripe amount units are paise). Card details never pass through or get stored by this app. The invoice is marked paid only by a Stripe webhook with a valid signature and a matching invoice number, INR currency, total and Checkout session. Configure the Stripe webhook signing secret as `STRIPE_WEBHOOK_SECRET` and protect all Stripe/Resend keys in Render environment settings only.

Invoice signing URLs depend on `INVOICE_TOKEN_SECRET`; changing it invalidates previously issued invoice links. For security and billing records, use Stripe test keys and send test invoices before switching to live credentials. GST invoices and tax treatment should be reviewed by your accountant before production use.

## Search, analytics, and backups

- Service-specific pages are available at `/web-development`, `/ai-ml`, `/cloud-devops`, `/mobile-apps`, `/software-integrations`, `/ui-ux-design`, and `/digital-solutions`. `public/sitemap.xml` and `public/robots.txt` expose those pages for crawling.
- Visitor and lead-conversion analytics require a GA4 measurement ID in `public/config.js`. GA4 is not loaded unless a visitor consents to analytics; lead source paths are also shown in the admin dashboard and included in owner notification emails.
- The Render service creates and verifies a SQLite snapshot at startup and every 24 hours. Run `npm run backup` to create one manually. `DATABASE_PATH` must point to the live database; `BACKUP_DIR` defaults to a sibling `backups` directory and snapshots older than `BACKUP_RETENTION_DAYS` (30 days by default) are removed. Store or copy backups off the Render disk for disaster recovery; a backup on the same disk is not an independent backup.
- Render mounts `/var/data` as persistent storage. Keep `DATABASE_PATH=/var/data/leads.sqlite` and verify persistence by submitting an enquiry, restarting the service, and confirming it remains in `/admin`. The automated integration suite also verifies persistence across a backend restart using an isolated temporary database.

## Hosting notes

The SQLite database must be stored on a persistent writable volume. An ephemeral server filesystem will lose the database when the host replaces the instance. SQLite is a single-node starter database; use managed PostgreSQL and Prisma before scaling the CRM or running multiple backend instances.

For a separately hosted static site and API, set `apiBaseUrl` in `public/config.js` to the backend origin and include the static website origin in `CORS_ORIGINS`. Never place the admin key or other secrets in `public/`.

The current admin bearer key is a lightweight protection for the lead APIs, not a replacement for the planned user accounts, session authentication, role-based permissions, or audit logging.
