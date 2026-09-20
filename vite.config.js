import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

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
    build: { outDir: process.env.CLAW_BUILD_OUT_DIR || 'dist' },
    optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
    define: { __BUILD_INFO__: JSON.stringify(build) },
    plugins: [{
      name: 'build-identity',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(build, null, 2) });
      },
    }],
  };
});
