import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function backup(source, destination) {
  // VACUUM INTO produces a consistent standalone snapshot, including committed WAL data.
  // SQLite refuses to replace an existing nonempty destination.
  const db = new DatabaseSync(source, { readOnly: true });
  try { db.prepare('VACUUM INTO ?').run(destination); }
  finally { db.close(); }
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
  } finally { copy.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node server/backup.js source.sqlite new-backup.sqlite');
  backup(resolve(process.argv[2]), resolve(process.argv[3]));
  console.log('Consistent backup created and verified.');
}
