// One-off CI diagnostic: run the same camera fixture after grab-release on
// two exact source commits. Only the browser test is instrumented at runtime.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = process.cwd();
const output = join(root, '.screenshots/camera-ci-comparison');
await mkdir(output, { recursive: true });

const initMarker = "  await page.addInitScript(() => { window.mediaCalls = 0; const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = options => { window.mediaCalls++; return original(options); }; });";
const trackMarker = "  await page.evaluate(() => document.getElementById('camera-video').srcObject.getVideoTracks().forEach(track => { track.enabled = false; }));";
const initDiagnostic = `  await page.addInitScript(() => {
    const diagnostic = window.__cameraDiagnostic = { events: [], framesSent: 0, results: 0, lastFrameSentMs: null, lastWorkerMessageMs: null, lastResultMs: null };
    const record = (kind, detail = {}) => {
      diagnostic.events.push({ ms: Math.round(performance.now()), kind, ...detail });
      if (diagnostic.events.length > 60) diagnostic.events.shift();
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        record('worker-created');
        this.addEventListener('message', event => {
          const type = event.data?.type || 'unknown';
          diagnostic.lastWorkerMessageMs = performance.now();
          if (type === 'result') {
            diagnostic.results++;
            diagnostic.lastResultMs = performance.now();
            if (diagnostic.results % 30 === 0) record('results', { count: diagnostic.results });
          } else record('worker-message', { type });
        });
        this.addEventListener('error', event => record('worker-error', { message: event.message }));
      }
      postMessage(...args) {
        const type = args[0]?.type;
        if (type === 'frame') {
          diagnostic.framesSent++;
          diagnostic.lastFrameSentMs = performance.now();
          if (diagnostic.framesSent % 30 === 0) record('frames-sent', { count: diagnostic.framesSent });
        } else record('worker-post', { type: type || 'unknown' });
        return super.postMessage(...args);
      }
    };
    const owner = [HTMLMediaElement.prototype, HTMLVideoElement.prototype].find(proto => Object.getOwnPropertyDescriptor(proto, 'srcObject'));
    const descriptor = owner && Object.getOwnPropertyDescriptor(owner, 'srcObject');
    if (descriptor?.configurable && descriptor.get && descriptor.set) {
      Object.defineProperty(owner, 'srcObject', {
        configurable: true, enumerable: descriptor.enumerable,
        get() { return descriptor.get.call(this); },
        set(value) {
          if (this.id === 'camera-video') {
            record('srcObject', { attached: !!value, stack: new Error().stack?.split('\\n').slice(1, 5).join(' | ') });
            for (const track of value?.getTracks?.() || []) {
              for (const type of ['ended', 'mute', 'unmute']) track.addEventListener(type, () => record('track-' + type, { readyState: track.readyState }));
            }
          }
          return descriptor.set.call(this, value);
        },
      });
    } else record('srcObject-intercept-unavailable');
    document.addEventListener('visibilitychange', () => record('visibility', { hidden: document.hidden }));
    window.addEventListener('pagehide', () => record('pagehide'));
    navigator.mediaDevices?.addEventListener('devicechange', () => record('devicechange'));
  });`;
const atTrack = `  const cameraDiagnostic = await page.evaluate(() => {
    const video = document.getElementById('camera-video');
    const stream = video.srcObject;
    const camera = window.__littleCloud?.snapshot().event.handCamera;
    return {
      ms: Math.round(performance.now()), hidden: document.hidden, visibilityState: document.visibilityState,
      cameraStatus: document.getElementById('camera-status').textContent,
      status: document.getElementById('status').textContent,
      video: { hasStream: !!stream, readyState: video.readyState, currentTime: video.currentTime,
        tracks: stream?.getTracks().map(track => ({ kind: track.kind, readyState: track.readyState, enabled: track.enabled, muted: track.muted })) || [] },
      camera: { running: camera?.running, waiting: camera?.waiting, feedback: camera?.feedback, diagnostic: camera?.diagnostic },
      errors: window.__littleCloud?.snapshot().errors,
      worker: window.__cameraDiagnostic,
    };
  });
  console.log('CAMERA_DIAG', JSON.stringify({ case: process.env.CAMERA_DIAG_CASE, ...cameraDiagnostic, pageErrors: errors }));`;

function instrumentSource(source) {
  if (source.split(initMarker).length !== 2 || source.split(trackMarker).length !== 2) {
    throw new Error('Camera fixture markers changed');
  }
  source = source.replace(initMarker, `${initMarker}\n${initDiagnostic}`);
  source = source.replace(trackMarker, `${atTrack}\n${trackMarker}`);
  return source;
}

async function instrument(caseDir) {
  const file = join(caseDir, 'tests/camera.browser.mjs');
  const source = instrumentSource(await readFile(file, 'utf8'));
  await writeFile(file, source);
  execFileSync(process.execPath, ['--check', file]);
}

if (process.argv.includes('--self-check')) {
  const fixture = instrumentSource(await readFile(join(root, 'tests/camera.browser.mjs'), 'utf8'));
  const file = join(output, 'camera-self-check.mjs');
  await writeFile(file, fixture);
  execFileSync(process.execPath, ['--check', file]);
  console.log('PASS instrumented camera fixture syntax');
  process.exit(0);
}

async function run(name) {
  const caseDir = resolve(root, 'cases', name);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: caseDir, encoding: 'utf8' }).trim();
  await instrument(caseDir);
  const changed = execFileSync('git', ['status', '--short'], { cwd: caseDir, encoding: 'utf8' }).trim();
  if (changed !== 'M tests/camera.browser.mjs') throw new Error(`Unexpected source changes in ${name}: ${changed}`);
  const logFile = join(output, `${name}.log`);
  const child = spawn(process.execPath, ['scripts/check-browser.mjs', '--only', 'grab-release,camera'], {
    cwd: caseDir, env: { ...process.env, CAMERA_DIAG_CASE: name }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));
  child.stderr.on('data', chunk => chunks.push(chunk));
  const [code, signal] = await new Promise(resolve => child.on('close', (...args) => resolve(args)));
  const log = Buffer.concat(chunks).toString('utf8');
  await writeFile(logFile, log);
  console.log(`CASE ${name} source=${commit} exit=${code} signal=${signal || 'none'}`);
  for (const line of log.split('\n').filter(line => /CAMERA_DIAG|PASS .*browser suite|FAIL .*browser suite|camera browser check failed|page\.evaluate:|worker_timeout/.test(line))) console.log(line);
  return { case: name, commit, exitCode: code, signal, diagnostic: log.split('\n').filter(line => line.includes('CAMERA_DIAG')) };
}

const results = [];
for (const name of ['base', 'pr']) results.push(await run(name));
await writeFile(join(output, 'summary.json'), JSON.stringify(results, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = results.map(result => `- ${result.case} \`${result.commit.slice(0, 7)}\`: exit ${result.exitCode}, diagnostic ${result.diagnostic.length ? 'captured' : 'missing'}`).join('\n');
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Paired camera lifecycle comparison\n\n${summary}\n`);
}
if (results.some(result => result.exitCode !== 0 || result.diagnostic.length !== 1)) process.exitCode = 1;
