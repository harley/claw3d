import { existsSync, mkdirSync, renameSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { backup } from './backup.js';

// Called after volume validation, before opening/migrating the live database.
// One immutable snapshot per deployment; process restarts never overwrite it.
export function backupForRelease(dataDir, commit, deploymentId = randomUUID()) {
  if (!/^[a-f0-9]{7,40}$/.test(commit ?? '')) throw new Error('Release backup requires a valid build commit.');
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(deploymentId)) throw new Error('Invalid release deployment ID.');
  const source = join(dataDir, 'pilot.sqlite');
  if (!existsSync(source)) return null; // First deployment has no data to preserve.
  const directory = join(dataDir, 'release-backups');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, `${commit}-${deploymentId}.sqlite`);
  if (existsSync(destination)) {
    const saved = new DatabaseSync(destination, { readOnly: true });
    try {
      if (saved.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Release backup is corrupt.');
    } finally { saved.close(); }
    return destination;
  }
  // Publish only a completely written, integrity-checked snapshot. Remove
  // partial copies on failure so retries do not consume the remaining volume.
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    backup(source, temporary);
    chmodSync(temporary, 0o600);
    renameSync(temporary, destination);
  } finally { rmSync(temporary, { force: true }); }
  return destination;
}
