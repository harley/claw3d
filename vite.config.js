import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { offlinePack } from './scripts/offline-pack.mjs';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export default defineConfig(() => {
  const suppliedCommit = process.env.BUILD_COMMIT;
  if (suppliedCommit && !/^[a-f0-9]{7,40}$/.test(suppliedCommit)) throw new Error('Invalid BUILD_COMMIT');
  const build = {
    sourceCommit: suppliedCommit || git('rev-parse', 'HEAD'),
    commit: suppliedCommit ? suppliedCommit.slice(0, 7) : git('rev-parse', '--short', 'HEAD'),
    branch: suppliedCommit ? process.env.BUILD_BRANCH || 'deployment' : git('branch', '--show-current') || 'detached',
    dirty: suppliedCommit ? process.env.BUILD_DIRTY !== 'false' : Boolean(git('status', '--porcelain', '--untracked-files=normal')),
    builtAt: new Date().toISOString(),
  };
  return {
    // Prebundle the lazy camera dependency before play; discovering it at
    // camera startup otherwise reloads the page and interrupts acquisition.
    build: { outDir: process.env.CLAW_BUILD_OUT_DIR || 'dist', rolldownOptions: { preserveEntrySignatures: 'strict', input: { index: 'index.html', 'host-preparation': 'src/host-preparation.js' }, output: { entryFileNames: chunk => chunk.name === 'host-preparation' ? 'host-preparation.js' : 'assets/[name]-[hash].js' } } },
    // Dedicated camera workers need a URL inside the prepared scope so their
    // own model/WASM requests stay controlled after an offline restart.
    worker: { rolldownOptions: { output: { entryFileNames: chunk => `${chunk.name === 'prepared-vision-worker' ? 'prepared' : 'assets'}/[name]-[hash].js` } } },
    optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
    define: { __BUILD_INFO__: JSON.stringify(build) },
    plugins: [offlinePack(), {
      name: 'build-identity',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(build, null, 2) });
      },
    }],
  };
});
