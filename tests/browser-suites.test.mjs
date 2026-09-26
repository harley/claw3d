import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
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
  // The real-server journeys run sequentially in the required shared job.
  const shared = ['connection-policy', 'shared-session', 'public-try', 'host-events', 'official-player'];
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts;
  assert.equal(scripts['test:shared'], shared.map(name => `node tests/${name}.browser.mjs`).join(' && '));
  const entries = readdirSync(new URL('.', import.meta.url))
    .filter(name => name.endsWith('.browser.mjs') && !shared.some(suite => name === `${suite}.browser.mjs`))
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
