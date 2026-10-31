const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const configuredPath = process.env.DATABASE_PATH;
const databasePath = configuredPath
  ? path.resolve(configuredPath)
  : path.resolve(__dirname, '..', 'data', 'leads.sqlite');
const backupDirectory = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(path.dirname(databasePath), 'backups');
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);

if (!fs.existsSync(databasePath)) {
  throw new Error(`SQLite database does not exist: ${databasePath}`);
}

if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
  throw new Error('BACKUP_RETENTION_DAYS must be a positive whole number.');
}

fs.mkdirSync(backupDirectory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDirectory, `leads-${timestamp}.sqlite`);
if (path.resolve(backupPath) === path.resolve(databasePath)) {
  throw new Error('The backup path must differ from the live database path.');
}

let database;
let backupVerified = false;
try {
  database = new DatabaseSync(databasePath);
  database.exec('PRAGMA busy_timeout = 5000');
  const escapedPath = backupPath.replace(/'/g, "''");
  database.exec(`VACUUM INTO '${escapedPath}'`);
  database.close();
  database = null;

  const verification = new DatabaseSync(backupPath, { readOnly: true });
  const integrity = verification.prepare('PRAGMA integrity_check').get();
  verification.close();
  if (integrity.integrity_check !== 'ok') {
    throw new Error(`SQLite backup integrity check failed: ${integrity.integrity_check}`);
  }
  backupVerified = true;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(backupDirectory)) {
    if (!/^leads-\d{4}-\d{2}-\d{2}T.*\.sqlite$/.test(name) || name === path.basename(backupPath))
      continue;
    const candidate = path.join(backupDirectory, name);
    const stats = fs.statSync(candidate);
    if (stats.isFile() && stats.mtimeMs < cutoff) fs.unlinkSync(candidate);
  }

  console.log(`SQLite backup created and verified: ${backupPath}`);
} catch (error) {
  if (database) database.close();
  if (!backupVerified && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  throw error;
}
