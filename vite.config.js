import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export default defineConfig(() => {
  const build = {
    commit: git('rev-parse', '--short', 'HEAD'),
    branch: git('branch', '--show-current') || 'detached',
    dirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')),
    builtAt: new Date().toISOString(),
  };
  return {
    // Prebundle the lazy camera dependency before play; discovering it at
    // camera startup otherwise reloads the page and interrupts acquisition.
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
