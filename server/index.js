import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat, mkdir, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, openDatabase } from './database.js';
import { createPlaytestStore } from './playtest.js';
import { backupForRelease } from './release-backup.js';
import { createBudget, clientAddressResolver } from './request-budget.js';
import { createPublicDiagnostics } from './public-diagnostics.js';
import { createOfficialHttp, isOfficialPath } from './official-http.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const matches = (a, b) => typeof a === 'string' && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const token = () => randomBytes(32).toString('base64url');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png', '.task': 'application/octet-stream' };
const gate = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cloud Claw · Staff pilot</title><style>body{background:#080e1c;color:#f4eee5;font:18px system-ui;display:grid;place-content:center;min-height:95vh;margin:0}main{max-width:360px;padding:24px}small{color:#ffba60}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;margin:12px 0;border-radius:8px;border:1px solid #aaa}button{background:#ffba60;color:#111;font-weight:700}p{line-height:1.5}</style><main><small>CODERPUSH × AWS CLOUD DAY</small><h1>Cloud Claw</h1><p>Staff pilot · enter your access code.</p><form id="login"><label for="code">Staff code</label><input id="code" type="password" autocomplete="current-password" required maxlength="128"><button>ENTER THE ARCADE</button><p id="message" role="status"></p></form></main><script>document.getElementById('login').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})});if(!r.ok)throw Error((await r.json()).error);location.replace('/staff')}catch(e){document.getElementById('message').textContent=e.message}finally{button.disabled=false}};</script></html>`;

export async function createPilotServer(options) {
  const { filename, origin, staffCode, hostCode, dist = resolve('dist'), secure = true,
    officialEventsEnabled = false, officialAdmissionsEnabled = false, publicDiagnosticsEnabled = false, publicTryEnabled = false, trustedProxyPeers = [] } = options;
  if (typeof officialEventsEnabled !== 'boolean' || typeof officialAdmissionsEnabled !== 'boolean') throw new Error('Event feature options must be booleans.');
  if (typeof publicDiagnosticsEnabled !== 'boolean') throw new Error('Diagnostics option must be a boolean.');
  if (typeof publicTryEnabled !== 'boolean') throw new Error('Public Try option must be a boolean.');
  const publicAsset = path => /^\/(?:assets\/[a-zA-Z0-9_-]+\.(?:js|css)|models\/hands\/(?:left|right)\.glb|vision\/(?:gesture_recognizer\.task|wasm\/[a-zA-Z0-9_-]+\.(?:js|wasm)))$/.test(path);
  const clientAddress = clientAddressResolver(trustedProxyPeers);
  if (!origin || !staffCode || !hostCode || staffCode.length < 16 || hostCode.length < 8 || staffCode === hostCode) throw new Error('A fixed origin, a staff secret of at least 16 characters and a distinct host code of at least 8 characters are required.');
  const database = openDatabase(filename), { db } = database;
  const root = await realpath(dist), attempts = createBudget();
  const playtest = createPlaytestStore(db);
  function cookie(name, value, age, path = '/') { return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`; }
  function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('='))); }
  function session(req) {
    const value = cookies(req).cc_session;
    return value ? db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hash(value), Date.now()) : null;
  }
  function issue(owner, role, res) {
    const value = token();
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(value), owner, role, Date.now() + 12 * 3600_000);
    res.setHeader('Set-Cookie', cookie('cc_session', value, 12 * 3600));
  }
  function limit(req, auth, login = false, telemetry = false) {
    // Preserve the existing staff-pilot ingress contract; proxy migration is separate
    // from the default-off public diagnostics routes below.
    const forwarded = req.headers['x-real-ip'];
    const loginIp = secure ? typeof forwarded === 'string' && isIP(forwarded) ? forwarded : 'unknown-proxy-client' : req.socket.remoteAddress;
    const key = login ? `login:${loginIp}` : `${telemetry ? 'playtest' : 'write'}:${auth.owner_id}`;
    attempts.take(key, login ? 12 : telemetry ? 60 : 120);
  }

  async function body(req, maxBytes = 4096) {
    if (req.headers.origin !== origin) throw new ApiError(403, 'Use this pilot’s own page to make changes.');
    if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'JSON required.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw new ApiError(413, 'Request too large.');
      chunks.push(chunk);
    }
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed; }
    catch { throw new ApiError(400, 'Invalid request.'); }
  }
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
  const official = officialEventsEnabled ? createOfficialHttp({ db, body, json, cookies, cookie, limit, admissionsEnabled: officialAdmissionsEnabled }) : null;
  const diagnostics = publicDiagnosticsEnabled ? createPublicDiagnostics({ db, body, json, cookies, cookie, clientAddress }) : null;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, origin), path = url.pathname;
      if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok: true });
      if (path.startsWith('/api/public/')) {
        if (!diagnostics) throw new ApiError(404, 'Public diagnostics are not enabled.');
        await diagnostics.handle(req, res, path); return;
      }
      const auth = session(req);
      if (isOfficialPath(path)) {
        if (!official) throw new ApiError(404, 'Event API is not enabled.');
        await official.handle(req, res, path, auth); return;
      }
      if (req.method === 'POST' && path === '/api/login') {
        limit(req, null, true);
        const input = await body(req);
        if (!matches(input.code, staffCode)) throw new ApiError(401, 'That staff code was not accepted.');
        let ownerToken = cookies(req).cc_owner;
        if (!ownerToken || !db.prepare('SELECT id FROM owners WHERE id=?').get(hash(ownerToken))) {
          ownerToken = token(); db.prepare('INSERT INTO owners VALUES (?)').run(hash(ownerToken));
        }
        if (auth) db.prepare('DELETE FROM sessions WHERE token=?').run(auth.token);
        issue(hash(ownerToken), 'staff', res);
        res.setHeader('Set-Cookie', [res.getHeader('Set-Cookie'), cookie('cc_owner', ownerToken, 90 * 86400)]);
        return json(res, 200, { ok: true });
      }
      const publicPage = publicTryEnabled && ['/', '/try'].includes(path);
      const publicRead = publicTryEnabled && ['GET', 'HEAD'].includes(req.method) && (publicPage || publicAsset(path));
      if (!auth && !publicRead) {
        if (['/', '/staff'].includes(path) && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(gate); }
        throw new ApiError(401, 'Sign in with the staff code to continue.');
      }
      if (path.startsWith('/api/')) {
        if (req.method === 'GET' && path === '/api/session') return json(res, 200, { role: auth.role, board: database.board() });
        if (req.method === 'GET' && path === '/api/board') return json(res, 200, database.board());
        const runMatch = /^\/api\/runs\/([a-f0-9-]{36})(?:\/(turns|abandon))?$/.exec(path);
        if (req.method === 'GET' && runMatch && !runMatch[2]) return json(res, 200, database.getRun(runMatch[1], auth.owner_id));
        if (req.method === 'GET' && path === '/api/host/export') {
          if (auth.role !== 'host') throw new ApiError(403, 'Host access required.');
          res.setHeader('Content-Disposition', 'attachment; filename="cloud-claw-sessions.json"');
          return json(res, 200, database.exportData());
        }
        if (req.method === 'GET' && path === '/api/host/playtest') {
          if (auth.role !== 'host') throw new ApiError(403, 'Host access required.');
          return json(res, 200, playtest.read(url.searchParams.get('since')));
        }
        if (req.method === 'GET' && path === '/api/host/public-playtest') {
          if (auth.role !== 'host') throw new ApiError(403, 'Host access required.');
          if (!diagnostics) throw new ApiError(404, 'Public diagnostics are not enabled.');
          return json(res, 200, diagnostics.read(url.searchParams.get('since')));
        }
        if (req.method === 'POST' && path === '/api/playtest') {
          limit(req, auth, false, true);
          return json(res, 200, playtest.ingest(await body(req, 65536)));
        }
        if (req.method !== 'POST') throw new ApiError(404, 'Route not found.');
        limit(req, auth);
        const input = await body(req);
        if (path === '/api/logout') {
          db.prepare('DELETE FROM sessions WHERE token=?').run(auth.token);
          res.setHeader('Set-Cookie', cookie('cc_session', '', 0)); return json(res, 200, { ok: true });
        }
        if (path === '/api/host/login') {
          limit(req, auth, true);
          if (!matches(input.code, hostCode)) throw new ApiError(403, 'That host code was not accepted.');
          db.prepare('DELETE FROM sessions WHERE token=?').run(auth.token);
          issue(auth.owner_id, 'host', res); return json(res, 200, { role: 'host' });
        }
        if (path === '/api/host/boards') {
          if (auth.role !== 'host') throw new ApiError(403, 'Host access required.');
          return json(res, 201, database.rotate(input.name));
        }
        if (path === '/api/runs') return json(res, 201, database.createRun(auth.owner_id, input));
        if (runMatch?.[2] === 'turns') return json(res, 200, database.record(runMatch[1], auth.owner_id, input));
        if (runMatch?.[2] === 'abandon') return json(res, 200, database.abandon(runMatch[1], auth.owner_id));
        throw new ApiError(404, 'Route not found.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, 'Method not allowed.');
      let relative;
      try { relative = decodeURIComponent(path); } catch { throw new ApiError(400, 'Invalid path.'); }
      const file = resolve(root, `.${['/', '/staff'].includes(relative) || publicPage ? '/index.html' : relative}`);
      if (!file.startsWith(root + sep)) throw new ApiError(404, 'File not found.');
      let actual;
      try { actual = await realpath(file); if (!actual.startsWith(root + sep) || !(await stat(actual)).isFile()) throw Error(); }
      catch { throw new ApiError(404, 'File not found.'); }
      if (!auth && !publicPage && !publicAsset('/' + actual.slice(root.length + 1).split(sep).join('/'))) throw new ApiError(404, 'File not found.');
      let content = await readFile(actual);
      if (actual === resolve(root, 'index.html')) content = Buffer.from(content.toString().replace('<head>', publicPage
        ? `<head><script>window.__PUBLIC_TRY__=true;window.__PUBLIC_DIAGNOSTICS__=${publicDiagnosticsEnabled};</script>`
        : '<head><script>window.__SHARED_PILOT__=true;</script>'));
      res.writeHead(200, { 'Content-Type': mime[extname(actual)] || 'application/octet-stream', 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The score service is unavailable. Please retry.' });
      else res.end();
      if (!error.status) console.error('Pilot request failed:', error.code || error.name);
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  const retentionTimer = setInterval(() => {
    try { playtest.prune(); official?.pruneSessions(); diagnostics?.prune(); attempts.prune(); } catch (error) { console.error('Retention maintenance failed:', error.code || error.name); }
  }, 3600_000);
  retentionTimer.unref();
  server.once('close', () => clearInterval(retentionTimer));
  return { server, database, playtest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const production = process.env.NODE_ENV === 'production';
  const dataDir = resolve(process.env.DATA_DIR || '.local-data');
  if (production) {
    const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    if (!mount || resolve(mount) !== dataDir) throw new Error('Production requires DATA_DIR to match the attached Railway volume.');
    const mounts = await readFile('/proc/self/mountinfo', 'utf8');
    if (!mounts.split('\n').some(line => line.split(' ')[4] === dataDir)) throw new Error('Persistent volume is not mounted.');
    if (!process.env.PUBLIC_ORIGIN?.startsWith('https://')) throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (production) {
    const build = JSON.parse(await readFile(new URL('../dist/build-info.json', import.meta.url), 'utf8'));
    const snapshot = backupForRelease(dataDir, build.sourceCommit || build.commit, process.env.RAILWAY_DEPLOYMENT_ID);
    if (snapshot) console.log(`Pre-release database snapshot verified for ${build.commit}.`);
  }
  const { server, database } = await createPilotServer({ filename: resolve(dataDir, 'pilot.sqlite'), origin: process.env.PUBLIC_ORIGIN,
    staffCode: process.env.STAFF_CODE, hostCode: process.env.HOST_CODE, secure: production,
    publicTryEnabled: process.env.PUBLIC_TRY_ENABLED === 'true',
    publicDiagnosticsEnabled: process.env.PUBLIC_DIAGNOSTICS_ENABLED === 'true',
    trustedProxyPeers: process.env.TRUSTED_PROXY_PEERS ? process.env.TRUSTED_PROXY_PEERS.split(',').map(value => value.trim()) : [],
    officialEventsEnabled: process.env.OFFICIAL_EVENTS_ENABLED === 'true',
    officialAdmissionsEnabled: process.env.OFFICIAL_EVENT_ADMISSIONS === 'enabled' });
  server.listen(Number(process.env.PORT || 4200), production ? '0.0.0.0' : '127.0.0.1', () => console.log('Cloud Claw pilot listening.'));
  const stop = () => { server.close(() => { database.close(); process.exit(0); }); setTimeout(() => process.exit(1), 8000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
