import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, cp, mkdtemp, rename, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const mode = process.argv[2] || 'debug';
if (!['debug', 'release'].includes(mode)) throw new Error('Expected debug or release');
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const dirty = Boolean(git('status', '--porcelain', '--untracked-files=normal'));
if (mode === 'release' && dirty) throw new Error('Release builds require a clean checkout.');
if (mode === 'release' && ['CLAW_KEYSTORE', 'CLAW_STORE_PASSWORD', 'CLAW_KEY_ALIAS', 'CLAW_KEY_PASSWORD'].some(name => !process.env[name])) {
 throw new Error('Release signing is not configured. See docs/OPERATIONS.md#android-distribution.');
}
const versionText = await readFile('android/version.properties', 'utf8');
const versionName = /^versionName=(\d+\.\d+\.\d+)$/m.exec(versionText)?.[1];
const versionCode = Number(/^versionCode=([1-9]\d*)$/m.exec(versionText)?.[1]);
if (!versionName || !Number.isSafeInteger(versionCode) || versionCode > 2100000000) throw new Error('Invalid android/version.properties');
const model = await readFile('public/vision/gesture_recognizer.task');
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(model) !== '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482') throw new Error('Unexpected gesture model checksum');
const env = { ...process.env, BUILD_COMMIT: commit, BUILD_BRANCH: git('branch', '--show-current') || 'detached', BUILD_DIRTY: String(dirty), CLAW_ANDROID_COMMIT: commit, CLAW_ANDROID_DIRTY: String(dirty) };
// Build in a fresh directory: no stale JS chunks or assets from another revision.
const buildRoot = resolve('android/build');
await mkdir(buildRoot, { recursive: true });
const webBuild = await mkdtemp(join(buildRoot, 'web-'));
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { env: { ...env, CLAW_BUILD_OUT_DIR: webBuild } });
const generatedRoot = resolve('android/app/build/generated');
await mkdir(generatedRoot, { recursive: true });
const staging = await mkdtemp(join(generatedRoot, 'game-'));
await cp(webBuild, join(staging, 'web'), { recursive: true });
await writeFile(join(staging, 'gesture_recognizer.task'), model);
const files = {};
async function inventory(directory, prefix = '') {
 for (const entry of await readdir(directory, { withFileTypes: true })) {
  const name = prefix + entry.name;
  if (entry.isDirectory()) await inventory(join(directory, entry.name), name + '/');
  else files[name] = hash(await readFile(join(directory, entry.name)));
 }
}
await inventory(staging);
await writeFile(join(staging, 'asset-manifest.json'), JSON.stringify({ commit, dirty, files }, null, 2));
const destination = join(generatedRoot, 'gameAssets');
try { await rename(destination, join(generatedRoot, `previous-${Date.now()}`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await rename(staging, destination);
run('./gradlew', [mode === 'release' ? 'assembleRelease' : 'assembleDebug', 'testDebugUnitTest', 'lintDebug'], { cwd: resolve('android'), env });
const apk = await readFile(`android/app/build/outputs/apk/${mode}/app-${mode}.apk`);
const output = resolve('android/build/distributions'); await mkdir(output, { recursive: true });
const filename = `cloud-claw-${versionName}-${mode}-${commit.slice(0, 7)}${dirty ? '-dirty' : ''}.apk`;
await writeFile(join(output, filename), apk);
await writeFile(join(output, filename + '.sha256'), `${hash(apk)}  ${filename}\n`);
await writeFile(join(output, filename + '.json'), JSON.stringify({ versionName, versionCode, commit, dirty, mode, apkSha256: hash(apk), physicalAcceptance: 'not-established-by-build' }, null, 2));
console.log(`APK: ${join(output, filename)}`);
