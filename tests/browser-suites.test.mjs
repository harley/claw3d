import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { browserShards, browserSuites, selectBrowserSuites } from '../scripts/browser-suites.mjs';

test('defaults to all browser suites in their established sequential order', () => {
  assert.deepEqual(selectBrowserSuites(), browserSuites);
});

test('--only selects a named subset in requested order', () => {
  assert.deepEqual(selectBrowserSuites(['--only', 'camera, arcade,contact']), ['camera', 'arcade', 'contact']);
});

test('--shard selects its configured suite group', () => {
  assert.deepEqual(selectBrowserSuites(['--shard', 'shard-3']), browserShards['shard-3']);
});

test('CI shards cover every browser suite exactly once', () => {
  // Shared-session owns a separate required job with its real server.
  const entries = readdirSync(new URL('.', import.meta.url))
    .filter(name => name.endsWith('.browser.mjs') && name !== 'shared-session.browser.mjs')
    .map(name => name.slice(0, -'.browser.mjs'.length)).sort();
  assert.deepEqual([...browserSuites].sort(), entries);
  assert.deepEqual(Object.values(browserShards).flat().sort(), entries);
});

test('rejects malformed selection, duplicate suites, and unknown names', () => {
  assert.throws(() => selectBrowserSuites(['--only']), /requires a value/);
  assert.throws(() => selectBrowserSuites(['--only', 'camera,,arcade']), /comma-separated list/);
  assert.throws(() => selectBrowserSuites(['--only', 'camera,camera']), /Duplicate browser suite/);
  assert.throws(() => selectBrowserSuites(['--only', 'not-a-suite']), /Unknown browser suite/);
  assert.throws(() => selectBrowserSuites(['--shard', 'missing']), /Unknown browser shard/);
});
