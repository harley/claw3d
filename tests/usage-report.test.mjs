import test from 'node:test';
import assert from 'node:assert/strict';
import { usageReport } from '../scripts/usage-report.mjs';
import { deviceClass } from '../server/usage.js';

// Contract: count run receipts once in the booth window without inventing people
// or missing instrumentation. Existing score tests do not cover combined exports.
const run = (id, startedAt = '2026-09-29T09:00:00+07:00', extra = {}) => ({ id, startedAt, completedAt: '2026-09-29T09:02:00+07:00', total: 100, turns: [{}, {}, {}], rules: { controlMode: 'one-hand' }, ...extra });
const snapshot = (runs, extra = {}) => ({ version: 1, boards: [{ runs, ...extra }] });

test('window is start-based and half-open; unknown web coverage and modes remain separate', () => {
  const web = snapshot([
    run('setup', '2026-09-29T08:59:59+07:00'),
    run('old'),
    run('phone', undefined, { usage: { version: 1, deviceClass: 'phone' } }),
    run('end', '2026-09-30T00:00:00+07:00'),
  ], { usageSource: 'public-web' });
  web.boards.push({ runs: [run('staff')] });
  const android = [snapshot([run('tv', undefined, { rules: { controlMode: 'two-hand' } })])];
  const report = usageReport({ web, android });
  assert.deepEqual(report.totals, { completedPlays: 3, recordedStarts: 3, uniquePeople: null });
  assert.equal(report.excludedBefore, 1); assert.equal(report.excludedAfter, 1);
  assert.equal(report.rows.find(r => r.device === 'unknown').startsWithoutDeviceInstrumentation, 1);
  assert.equal(report.rows.find(r => r.device === 'phone').completedPlays, 1);
  assert.equal(report.rows.find(r => r.device === 'tv').mode, 'two-hand');
  assert.ok(report.rows.every(r => r.hour === '2026-09-29T09:00:00+07:00'));
  assert.equal(report.firstClassifiedWebStart, '2026-09-29T09:00:00+07:00');
});

test('repeated exports deduplicate and a completed receipt wins over an older active snapshot', () => {
  const done = snapshot([run('tv')]);
  const early = { ...snapshot([]), active: run('tv', undefined, { completedAt: undefined, turns: [] }) };
  for (const android of [[early, done, done], [done, early, done]]) {
    assert.equal(usageReport({ android }).totals.completedPlays, 1);
    assert.equal(usageReport({ android }).totals.recordedStarts, 1);
  }
  assert.throws(() => usageReport({ android: [done, snapshot([run('tv', undefined, { total: 200 })])] }), /Conflicting/);
});

test('unfinished records do not become plays; missing source is visible and invalid exports fail loudly', () => {
  const report = usageReport({ android: [snapshot([], { interruptedRuns: [run('interrupted')] })] });
  assert.equal(report.totals.completedPlays, 0);
  assert.equal(report.rows[0].unfinishedRecorded, 1);
  assert.equal(report.sources.web, false);
  assert.throws(() => usageReport({ web: snapshot([]) }), /identification missing/);
  assert.throws(() => usageReport({ android: [snapshot([run('bad', 'invalid')])] }), /start time/);
  assert.throws(() => usageReport({ since: '2026-09-29T09:00:00' }), /offsets/);
});

test('coarse browser categories do not infer a phone from unknown headers', () => {
  for (const [ua, expected] of [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'phone'],
    ['Mozilla/5.0 (Linux; Android 15) Mobile Safari', 'phone'],
    ['Mozilla/5.0 (Linux; Android 15) Safari', 'tablet'],
    ['Mozilla/5.0 (iPad; CPU OS 18_0)', 'tablet'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'desktop'],
    ['', 'unknown'], ['synthetic', 'unknown'],
  ]) assert.equal(deviceClass(ua), expected);
});

// Contract: selecting the wrong export must fail rather than inflate TV counts.
test('host exports cannot be counted as Android, including legacy host exports', () => {
  const marked = snapshot([run('web')], { usageSource: 'public-web' });
  assert.throws(() => usageReport({ web: marked, android: [marked] }), /Website export supplied as Android/);
  const legacy = { ...snapshot([run('staff')]), exportedAt: '2026-09-29T10:00:00+07:00' };
  assert.throws(() => usageReport({ android: [legacy] }), /Website export supplied as Android/);
});
