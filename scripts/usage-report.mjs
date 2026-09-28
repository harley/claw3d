import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SINCE = '2026-09-29T09:00:00+07:00';
export const DEFAULT_UNTIL = '2026-09-30T00:00:00+07:00';
const devices = new Set(['phone', 'tablet', 'desktop', 'unknown']);
const localHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23' });

// Only exported records are read. No camera hooks, network calls or database writes.
export function usageReport({ web, android = [], since = DEFAULT_SINCE, until = DEFAULT_UNTIL } = {}) {
  const from = Date.parse(since), to = Date.parse(until);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || !/(Z|[+-]\d\d:\d\d)$/.test(since) || !/(Z|[+-]\d\d:\d\d)$/.test(until)) throw new Error('Use an increasing ISO time window with explicit timezone offsets.');
  const records = new Map(), groups = new Map();
  let excludedBefore = 0, excludedAfter = 0, firstClassifiedStart = null;
  function add(run, source, status) {
    if (!run || typeof run.id !== 'string' || !run.id || !Number.isFinite(Date.parse(run.startedAt))) throw new Error('Export contains a run without a valid ID/start time.');
    const key = `${source}:${run.id}`;
    const item = { run, source, status };
    const previous = records.get(key);
    // Repeated snapshots must not count twice. A completed receipt supersedes
    // an earlier active/interrupted snapshot, irrespective of input file order.
    if (!previous || (previous.status !== 'complete' && status === 'complete')) records.set(key, item);
    else if (previous.status === 'complete' && status === 'complete' && (previous.run.total !== run.total || previous.run.startedAt !== run.startedAt)) throw new Error('Conflicting completed receipts for the same run.');
  }
  function ingest(data, source) {
    if (data?.version !== 1 || !Array.isArray(data.boards)) throw new Error('Expected a version 1 score export.');
    if (source === 'tomko-android' && (Object.hasOwn(data, 'exportedAt') || data.boards.some(board => board.usageSource === 'public-web'))) throw new Error('Website export supplied as Android. Use --web for the host export.');
    const boards = source === 'public-web' ? data.boards.filter(board => board.usageSource === 'public-web') : data.boards;
    if (source === 'public-web' && !boards.length) throw new Error('Public board identification missing. Download a fresh host export with usage reporting enabled.');
    for (const board of boards) {
      if (!Array.isArray(board.runs)) throw new Error('Export board is missing runs.');
      for (const run of board.runs) if (!run.practice) add(run, source, 'complete');
      for (const run of board.interruptedRuns || []) if (!run.practice) add(run, source, 'unfinished');
    }
    if (source === 'tomko-android' && data.active && !data.active.practice) add(data.active, source, 'unfinished');
  }
  if (web) ingest(web, 'public-web');
  for (const snapshot of android) ingest(snapshot, 'tomko-android');
  for (const { run, source, status } of records.values()) {
    const start = Date.parse(run.startedAt);
    if (start < from) { excludedBefore++; continue; }
    if (start >= to) { excludedAfter++; continue; }
    const device = source === 'tomko-android' ? 'tv' : devices.has(run.usage?.deviceClass) ? run.usage.deviceClass : 'unknown';
    const classified = source === 'public-web' && run.usage?.version === 1;
    if (classified && (!firstClassifiedStart || start < Date.parse(firstClassifiedStart))) firstClassifiedStart = run.startedAt;
    const mode = run.rules?.controlMode || 'one-hand';
    const hour = new Date(start + 7 * 3600000).toISOString().slice(0, 10) + 'T' + localHour.format(start) + ':00:00+07:00';
    const key = JSON.stringify([source, device, mode, hour]);
    if (!groups.has(key)) groups.set(key, { source, device, mode, hour, recordedStarts: 0, completedPlays: 0, unfinishedRecorded: 0, startsWithoutDeviceInstrumentation: 0, totalScore: 0 });
    const group = groups.get(key);
    group.recordedStarts++;
    if (source === 'public-web' && !classified) group.startsWithoutDeviceInstrumentation++;
    if (status === 'complete') {
      if (!Number.isFinite(run.total) || !run.completedAt || run.turns?.length !== 3) throw new Error('Completed run lacks a valid three-turn score receipt.');
      group.completedPlays++; group.totalScore += run.total;
    } else group.unfinishedRecorded++;
  }
  const rows = [...groups.values()].sort((a, b) => a.hour.localeCompare(b.hour) || a.source.localeCompare(b.source) || a.device.localeCompare(b.device) || a.mode.localeCompare(b.mode));
  return {
    version: 1, since, until, timeZone: 'Asia/Ho_Chi_Minh',
    sources: { web: Boolean(web), androidExports: android.length, webExportedAt: web?.exportedAt ?? null },
    firstClassifiedWebStart: firstClassifiedStart, excludedBefore, excludedAfter,
    totals: { completedPlays: rows.reduce((n, row) => n + row.completedPlays, 0), recordedStarts: rows.reduce((n, row) => n + row.recordedStarts, 0), uniquePeople: null },
    rows,
    notes: [
      'Counts use run start time, inclusive since and exclusive until; completion is as of the supplied exports.',
      'Device category is advisory. Phone does not prove practice intent or physical location. Names are not identities.',
      'Tomko counts require exports from both modes of the intended Android installation. Its clock must be correct. Missing exports are not zero activity.',
      'Android historical abandoned starts may be missing; do not calculate its completion rate from recordedStarts.',
      'Earlier web runs remain unknown. First classified start is observed coverage, not proof of deployment time. No backfill is inferred.',
      'Website and Android run identities are separate. No cross-channel person deduplication is possible.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = { android: [] }, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!value || !['--web', '--android', '--since', '--until'].includes(flag)) throw new Error('Usage: node scripts/usage-report.mjs [--web host-export.json] [--android mode-export.json ...] [--since ISO] [--until ISO]');
    if (flag === '--android') options.android.push(JSON.parse(readFileSync(value, 'utf8')));
    else if (flag === '--web') {
      if (options.web) throw new Error('Supply one latest website export.');
      options.web = JSON.parse(readFileSync(value, 'utf8'));
    } else options[flag.slice(2)] = value;
  }
  if (!options.web && !options.android.length) throw new Error('Supply at least one export; no input is not evidence of zero activity.');
  console.log(JSON.stringify(usageReport(options), null, 2));
}
