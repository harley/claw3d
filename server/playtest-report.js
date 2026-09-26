import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPlaytestReport } from './playtest.js';

// Reads the mounted observations only; never opens or prints authentication rows.
export function playtestReport(filename, since, { publicOnly = false } = {}) {
  if (typeof publicOnly !== 'boolean') throw new Error('publicOnly must be a boolean.');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    if (!publicOnly) return readPlaytestReport(db, since);
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_playtest_events'").get()) {
      throw new Error('Public observations unavailable: public_playtest_events is missing. This is not evidence of zero usage; verify deployed collection settings.');
    }
    return {
      cohort: 'public', collectionStatus: 'unknown',
      collectionNote: 'Read-only observations cannot establish whether collection is enabled. Empty results are not evidence of zero usage; verify deployed PUBLIC_DIAGNOSTICS_ENABLED.',
      ...readPlaytestReport(db, since, { publicOnly: true, maxEvents: 20_000 }),
    };
  }
  finally { db.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), publicOnly = args.at(-1) === '--public';
  if (publicOnly) args.pop();
  if (args.length < 1 || args.length > 2 || args.some(arg => arg.startsWith('--'))) throw new Error('Usage: node server/playtest-report.js database.sqlite [since-ISO-UTC] [--public]');
  process.stdout.write(JSON.stringify(playtestReport(args[0], args[1], { publicOnly }), null, 2) + '\n');
}
