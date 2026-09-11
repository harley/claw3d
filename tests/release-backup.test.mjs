import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupForRelease } from '../server/release-backup.js';

test('release backup preserves committed WAL data once per deployment and keeps older snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'claw-release-'));
  const db = new DatabaseSync(join(directory, 'pilot.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE scores(value INTEGER); INSERT INTO scores VALUES(100)');
    const first = backupForRelease(directory, '123abcd', 'deploy-one');
    db.exec('INSERT INTO scores VALUES(200)');
    assert.equal(backupForRelease(directory, '123abcd', 'deploy-one'), first);
    const second = backupForRelease(directory, '123abcd', 'rollback-two');
    for (const [file, total] of [[first, 100], [second, 300]]) {
      const snapshot = new DatabaseSync(file, { readOnly: true });
      try { assert.equal(snapshot.prepare('SELECT SUM(value) AS total FROM scores').get().total, total); }
      finally { snapshot.close(); }
    }
    assert.equal(db.prepare('SELECT SUM(value) AS total FROM scores').get().total, 300);
    writeFileSync(first, 'broken snapshot');
    assert.throws(() => backupForRelease(directory, '123abcd', 'deploy-one'));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('first deployment needs no snapshot and invalid build paths are rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'claw-release-'));
  try {
    assert.equal(backupForRelease(directory, '123abcd', 'deploy-one'), null);
    assert.throws(() => backupForRelease(directory, '../escape'));
    assert.throws(() => backupForRelease(directory, undefined));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('failed snapshots remove partial files before a restart retries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'claw-release-'));
  try {
    writeFileSync(join(directory, 'pilot.sqlite'), 'corrupt source');
    assert.throws(() => backupForRelease(directory, '123abcd', 'deployment'));
    assert.deepEqual(readdirSync(join(directory, 'release-backups')), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
