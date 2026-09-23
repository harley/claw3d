// Own a temporary dev server so checks cannot silently test a different checkout.
import { appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectBrowserSuites } from './browser-suites.mjs';

async function runBrowserChecks(suites) {
  const origin = 'http://127.0.0.1:4196';
  if (await fetch(origin).then(() => true, () => false)) {
    throw new Error('Port 4196 is already in use. Stop that dev server before running check:booth.');
  }
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4196', '--strictPort'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
  const exited = once(server, 'exit');
  let active;
  const stop = () => { active?.kill('SIGTERM'); server.kill('SIGTERM'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const results = [];
  const totalStarted = performance.now();
  let failure;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null || server.signalCode) throw new Error('Check server exited before readiness.');
      if (await fetch(origin).then(response => response.ok, () => false)) { ready = true; break; }
      await delay(250);
    }
    if (!ready) throw new Error('Check server did not become ready.');
    for (const suite of suites) {
      const started = performance.now();
      active = spawn(process.execPath, [`tests/${suite}.browser.mjs`], { stdio: 'inherit' });
      const [code, signal] = await once(active, 'exit');
      active = null;
      const seconds = (performance.now() - started) / 1000;
      results.push({ suite, seconds, passed: code === 0 });
      console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${suite} browser suite (${seconds.toFixed(1)}s)`);
      if (code !== 0) throw new Error(`${suite} browser check failed (${signal ? `signal ${signal}` : `exit ${code}`}).`);
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    stop();
    await exited;
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    const totalSeconds = (performance.now() - totalStarted) / 1000;
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      const status = failure ? 'failed' : 'passed';
      const lines = [
        '## Browser shard timings',
        '',
        '| Suite | Result | Duration |',
        '|---|---|---:|',
        ...results.map(({ suite, seconds, passed }) => `| ${suite} | ${passed ? 'passed' : 'failed'} | ${seconds.toFixed(1)} s |`),
        `| Total including server startup | ${status} | ${totalSeconds.toFixed(1)} s |`,
        '',
      ];
      await appendFile(summaryPath, `${lines.join('\n')}\n`);
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    await runBrowserChecks(selectBrowserSuites(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
