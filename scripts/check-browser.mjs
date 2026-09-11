// Own a temporary dev server so checks cannot silently test a different checkout.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'http://127.0.0.1:4196';
if (await fetch(origin).then(() => true, () => false)) {
  throw new Error('Port 4196 is already in use. Stop that dev server before running check:booth.');
}
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4196', '--strictPort'], { stdio: 'inherit' });
const exited = once(server, 'exit');
let active;
const stop = () => { active?.kill('SIGTERM'); server.kill('SIGTERM'); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null || server.signalCode) throw new Error('Check server exited before readiness.');
    if (await fetch(origin).then(response => response.ok, () => false)) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw new Error('Check server did not become ready.');
  for (const suite of ['audio', 'camera', 'gesture-feedback', 'arcade', 'carousel', 'contact', 'delivery-clearance']) {
    active = spawn(process.execPath, [`tests/${suite}.browser.mjs`], { stdio: 'inherit' });
    const [code] = await once(active, 'exit');
    active = null;
    if (code !== 0) throw new Error(`${suite} browser check failed.`);
  }
} finally {
  stop();
  await exited;
}
