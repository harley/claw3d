import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

export const packAsset = path => /^\/(?:prepared\/prepared-vision-worker-[a-zA-Z0-9_-]+\.js|assets\/[a-zA-Z0-9_-]+\.(?:js|css|svg)|models\/hands\/(?:left|right)\.glb|vision\/(?:gesture_recognizer\.task|wasm\/[a-zA-Z0-9_-]+\.(?:js|wasm)))$/.test(path);
export const requiredModels = [
  '/models/hands/left.glb', '/models/hands/right.glb', '/vision/gesture_recognizer.task',
  ...['vision_wasm_internal', 'vision_wasm_module_internal', 'vision_wasm_nosimd_internal'].flatMap(name => ['js', 'wasm'].map(extension => `/vision/wasm/${name}.${extension}`)),
];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.task': 'application/octet-stream', '.wasm': 'application/wasm' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function offlinePack() {
  let directory;
  return {
    name: 'prepared-public-assets',
    apply: 'build',
    configResolved(config) { directory = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      // Never use a server response: index.html at runtime contains auth/feature flags.
      const html = (await readFile(resolve(directory, 'index.html'), 'utf8')).replace('<head>', '<head><script>window.__PUBLIC_TRY__=true;window.__PUBLIC_PLAY__=true;window.__OFFLINE_SHELL__=true;</script>');
      await mkdir(resolve(directory, 'prepared'), { recursive: true });
      await writeFile(resolve(directory, 'prepared/index.html'), html);
      await writeFile(resolve(directory, 'prepared/client.js'), await readFile(new URL('../src/offline-assets.js', import.meta.url)));
      const paths = (await readdir(directory, { recursive: true })).map(path => '/' + path.replaceAll('\\', '/')).filter(packAsset);
      for (const required of requiredModels) if (!paths.includes(required)) throw Error(`Offline pack is missing ${required}`);
      paths.push('/prepared/index.html', '/prepared/client.js');
      const entries = await Promise.all(paths.sort().map(async url => {
        const bytes = await readFile(resolve(directory, '.' + url));
        return { url, bytes: bytes.length, type: types[extname(url)], sha256: digest(bytes) };
      }));
      const build = JSON.parse(await readFile(resolve(directory, 'build-info.json'), 'utf8'));
      const manifest = { build: { commit: build.commit, sourceCommit: build.sourceCommit }, version: 1, id: digest(JSON.stringify(entries)), bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries };
      const worker = await readFile(new URL('./offline/worker.js', import.meta.url), 'utf8');
      await writeFile(resolve(directory, 'prepared/manifest.json'), JSON.stringify(manifest));
      await writeFile(resolve(directory, 'prepared/worker.js'), `const PACK = ${JSON.stringify(manifest)};\n${worker}`);
    },
  };
}
