import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPlaytestReport } from './playtest.js';

// Reads the mounted observations only; never opens or prints authentication rows.
export function playtestReport(filename, since) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return readPlaytestReport(db, since); }
  finally { db.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: node server/playtest-report.js database.sqlite [since-ISO-UTC]');
  process.stdout.write(JSON.stringify(playtestReport(process.argv[2], process.argv[3]), null, 2) + '\n');
}
