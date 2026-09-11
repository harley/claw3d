import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const palette = { ivory: '#e8edf4', cherry: '#e82447', mint: '#236eb7', ink: '#403c37', brass: '#c6a46a', wood: '#b77d54' };
export const material = (color, roughness = .6, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness });
export const group = (parent, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
export function mesh(parent, geometry, mat, x = 0, y = 0, z = 0) { const m = new T.Mesh(geometry, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
const ballGeometry = new T.SphereGeometry(1, 24, 16);
export function ball(parent, mat, pos, scale) { const m = mesh(parent, ballGeometry, mat, ...pos); m.scale.set(...scale); return m; }
export function box(parent, mat, pos, size, radius = .035) { return mesh(parent, new RoundedBoxGeometry(...size, 3, Math.min(radius, ...size.map(s => s / 2))), mat, ...pos); }
export function cylinder(parent, mat, pos, radius, length, segments = 24) { return mesh(parent, new T.CylinderGeometry(radius, radius, length, segments), mat, ...pos); }
export function line(parent, mat, points, radius = .012) { return mesh(parent, new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), Math.max(8, points.length * 4), radius, 6, false), mat); }
export function rod(parent, mat, a, b, radius = .025) { const start = new T.Vector3(...a), end = new T.Vector3(...b), delta = end.clone().sub(start); const m = cylinder(parent, mat, start.add(end).multiplyScalar(.5).toArray(), radius, delta.length(), 12); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()); return m; }

// Merge only static parts. Keep articulated faces/ears/limbs as separate groups.
export function batch(root) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), buckets = new Map(), old = [];
  root.traverse(m => { if (!m.isMesh) return; const key = m.material.uuid; if (!buckets.has(key)) buckets.set(key, { mat: m.material, parts: [] }); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(inverse.clone().multiply(m.matrixWorld)); buckets.get(key).parts.push(g); old.push(m); });
  for (const m of old) m.removeFromParent();
  for (const { mat, parts } of buckets.values()) { const merged = mesh(root, mergeGeometries(parts, false), mat); merged.castShadow = !mat.transparent; parts.forEach(g => g.dispose()); }
}

function fabricTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d'), pixels = ctx.createImageData(128, 128);
  let seed = 31415;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { seed = (seed * 16807) % 2147483647; const v = 120 + ((x % 4 === 0 || y % 4 === 0) ? 40 : 0) + seed % 35; const i = (y * 128 + x) * 4; pixels.data.set([v, v, v, 255], i); }
  ctx.putImageData(pixels, 0, 0);
  const texture = new T.CanvasTexture(c); texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(5, 5); return texture;
}

export function label(parent, text, width, height, position, { color = '#f8edd8', background = null, size = 70, font = 'Georgia', weight = 'normal', tracking = 0 } = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * height / width);
  const ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${weight} ${size * 1024 / 500}px ${font}`;
  if (tracking && 'letterSpacing' in ctx) ctx.letterSpacing = `${tracking}px`;
  ctx.fillText(text, 512, c.height / 2, 980);
  const texture = new T.CanvasTexture(c); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4;
  const m = mesh(parent, new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), ...position); m.castShadow = m.receiveShadow = false; return m;
}

export function createArtMaterials() {
  const fabric = fabricTexture();
  const woodCanvas = document.createElement('canvas'); woodCanvas.width = 128; woodCanvas.height = 512;
  const wc = woodCanvas.getContext('2d'); wc.fillStyle = '#b9855b'; wc.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 75; i++) { wc.strokeStyle = i % 3 ? '#aa785322' : '#e2b77f38'; wc.lineWidth = i % 4 === 0 ? 2 : .6; wc.beginPath(); for (let y = 0; y <= 512; y += 8) { const x = i * 1.78 + Math.sin(y * .014 + i) * 1.4; y ? wc.lineTo(x, y) : wc.moveTo(x, y); } wc.stroke(); }
  const woodTexture = new T.CanvasTexture(woodCanvas); woodTexture.colorSpace = T.SRGBColorSpace;
  return {
    ivory: new T.MeshPhysicalMaterial({ color: palette.ivory, roughness: .32, clearcoat: .35, clearcoatRoughness: .3 }),
    red: new T.MeshPhysicalMaterial({ color: palette.cherry, roughness: .26, metalness: .12, clearcoat: .65, clearcoatRoughness: .22 }),
    mint: material(palette.mint, .66), paleMint: material('#95b5d0', .92), brass: material(palette.brass, .31, .75),
    chrome: material('#c4c8bd', .23, .88), darkMetal: material('#515c54', .37, .65), rubber: material('#47453c', .95),
    ink: material(palette.ink, .85), white: material('#fff5df', .87), wood: new T.MeshStandardMaterial({ map: woodTexture, roughness: .78, bumpMap: woodTexture, bumpScale: .006 }),
    glow: new T.MeshStandardMaterial({ color: '#ffe7b5', emissive: '#ffe1a0', emissiveIntensity: 1.3, roughness: .4 }),
    glass: new T.MeshPhysicalMaterial({ color: '#dceee2', transparent: true, opacity: .10, roughness: .08, metalness: .12, side: T.DoubleSide, depthWrite: false }),
    plush: color => new T.MeshPhysicalMaterial({ color, roughness: .96, bumpMap: fabric, bumpScale: .014, sheen: 1, sheenColor: new T.Color(color).lerp(new T.Color('white'), .3), sheenRoughness: 1 }),
  };
}

function eyes(parent, mats, x, y, z, sleepy = false) {
  const g = group(parent, 0, y, z);
  for (const side of [-1, 1]) {
    if (sleepy) line(g, mats.ink, [[side * x - .027, .005, 0], [side * x, -.013, .009], [side * x + .027, .005, 0]], .009);
    else { ball(g, mats.ink, [side * x, 0, 0], [.018, .027, .011]); ball(g, mats.white, [side * x - .005, .009, .010], [.0055, .007, .003]); }
  }
  return g;
}
function smile(parent, mats, y, z, width = .034) { line(parent, mats.ink, [[-width, y + .007, z], [0, y - .012, z + .008], [width, y + .007, z]], .006); }
function cheeks(parent, mat, x, y, z) { for (const side of [-1, 1]) ball(parent, mat, [side * x, y, z], [.035, .018, .005]); }

function starGeometry() {
  const points = Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .205 : .375; return new T.Vector2(Math.cos(a) * r, Math.sin(a) * r); });
  const shape = new T.Shape(), first = points[9].clone().lerp(points[0], .5); shape.moveTo(first.x, first.y);
  for (let i = 0; i < 10; i++) { const mid = points[i].clone().lerp(points[(i + 1) % 10], .5); shape.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y); }
  shape.closePath(); const g = new T.ExtrudeGeometry(shape, { depth: .17, bevelEnabled: true, bevelSegments: 7, steps: 1, bevelSize: .055, bevelThickness: .075, curveSegments: 12 }); g.translate(0, .40, -.085); g.deleteAttribute('normal'); g.deleteAttribute('uv'); const smooth = mergeVertices(g); smooth.computeVertexNormals(); g.dispose(); return smooth;
}

function cloudPoint(x, y, z) {
  const angle = Math.atan2(y, x), bump = y > 0 ? 1 + .13 * Math.cos(angle * 6 + Math.PI) : 1;
  return [x * .365 * bump, .31 + y * .252 * bump, z * .192];
}
function cloudGeometry() { const g = new T.SphereGeometry(1, 64, 40), pos = g.attributes.position; for (let i = 0; i < pos.count; i++) pos.setXYZ(i, ...cloudPoint(pos.getX(i), pos.getY(i), pos.getZ(i))); g.computeVertexNormals(); return g; }

export function createToy(data, mats) {
  const root = new T.Group(), body = group(root), parts = group(body), articulation = [], face = group(body);
  const fabric = mats.plush(data.color), light = mats.plush(new T.Color(data.color).lerp(new T.Color('#fff2d6'), .44));
  const blush = material('#cd887e', .94), seam = material(new T.Color(data.color).multiplyScalar(.76), .93);
  let blink;
  if (data.family === 'bunny') {
    ball(parts, fabric, [0, .31, 0], [.245, .29, .22]);
    ball(parts, light, [0, .30, .192], [.153, .185, .043]);
    ball(parts, fabric, [0, .64, .015], [.226, .211, .19]);
    for (const side of [-1, 1]) {
      ball(parts, fabric, [side * .15, .075, .09], [.105, .073, .145]);
      const arm = ball(parts, fabric, [side * .22, .32, .028], [.07, .135, .076]); arm.rotation.z = side * .22;
      const ear = group(body, side * .128, .785, 0); ear.rotation.z = side * -.19; ear.rotation.x = side === 1 ? -.55 : -.12;
      ball(ear, fabric, [side * .017, .135, 0], [.072, .205, .064]); ball(ear, light, [side * .016, .14, .053], [.039, .145, .014]); batch(ear); articulation.push({ object: ear, rest: ear.rotation.clone(), side });
    }
    ball(parts, light, [0, .565, .19], [.08, .052, .036]);
    ball(face, blush, [0, .590, .225], [.021, .015, .012]);
    line(face, mats.ink, [[0, .577, .229], [0, .554, .23]], .005);
    smile(face, mats, .553, .226, .026); blink = eyes(body, mats, .079, .66, .192);
    cheeks(face, blush, .133, .609, .177);
    for (let i = 0; i < 9; i++) { const a = i / 8 * 2.3 - 1.15; line(parts, seam, [[Math.sin(a) * .155 - .006, .30 + Math.cos(a) * .186, .21], [Math.sin(a) * .155 + .006, .30 + Math.cos(a) * .186 + .009, .21]], .0025); }
    const scarf = material(data.id === 'butter' ? '#bc5351' : '#858aaf', .85);
    box(parts, scarf, [0, .475, .18], [.15, .045, .06], .02); ball(parts, scarf, [.04, .43, .20], [.03, .074, .02]);
  } else if (data.family === 'capybara') {
    ball(parts, fabric, [0, .29, 0], [.31, .255, .235]);
    ball(parts, fabric, [0, .475, .035], [.26, .195, .225]);
    for (const side of [-1, 1]) { ball(parts, fabric, [side * .205, .619, .005], [.065, .071, .04]); ball(parts, light, [side * .207, .625, .038], [.036, .041, .01]); ball(parts, fabric, [side * .185, .061, .085], [.10, .065, .13]); }
    ball(parts, light, [0, .426, .231], [.185, .102, .055]);
    for (const side of [-1, 1]) ball(parts, mats.ink, [side * .044, .461, .281], [.013, .009, .005]);
    blink = eyes(body, mats, .135, .54, .219, true); smile(face, mats, .405, .286, .032);
    if (data.id === 'miso') { ball(parts, material('#d08b31', .83), [0, .694, .035], [.079, .065, .075]); const leaf = ball(parts, material('#6c8c54'), [.024, .754, .037], [.043, .008, .019]); leaf.rotation.z = -.35; }
    for (const side of [-1, 1]) for (let i = 0; i < 2; i++) line(parts, seam, [[side * .185 + i * .03 - .015, .074, .20], [side * .185 + i * .03 - .015, .042, .203]], .004);
  } else if (data.family === 'cloud') {
    mesh(parts, cloudGeometry(), fabric);
    const piping = [];
    for (let i = 0; i <= 80; i++) { const a = i / 80 * Math.PI * 2, point = cloudPoint(Math.cos(a) * .98, Math.sin(a) * .98, .20); piping.push(point); }
    line(parts, light, piping, .009);
    blink = eyes(body, mats, .079, .334, .19); smile(face, mats, .277, .192); cheeks(face, blush, .141, .288, .175);
    box(parts, material('#b65c55'), [.333, .19, .05], [.056, .026, .048], .004);
  } else if (data.family === 'star') {
    // Glossy candy, not refractive jelly: the transmission pass cost a full
    // extra scene render per frame and read as out of place beside the plush
    // toys (product decision 2026-09-12). The squish wave stays — it is the
    // jackpot's gameplay feedback.
    const candy = new T.MeshPhysicalMaterial({ color: data.color, roughness: .24, clearcoat: 1, clearcoatRoughness: .14, sheen: .5, sheenColor: new T.Color(data.color).lerp(new T.Color('#fff2d6'), .55), sheenRoughness: .6 });
    const wave = { value: 0 }, waveTime = { value: 0 };
    candy.onBeforeCompile = shader => { shader.uniforms.uSquish = wave; shader.uniforms.uToyTime = waveTime; shader.vertexShader = 'uniform float uSquish; uniform float uToyTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(position.y * 11.0 - uToyTime * 13.0) * uSquish * (0.3 + position.y);\ntransformed.z += cos(position.y * 9.0 - uToyTime * 11.0) * uSquish * 0.45;'); };
    root.userData.wave = wave; root.userData.waveTime = waveTime;
    mesh(parts, starGeometry(), candy);
    blink = eyes(body, mats, .077, .435, .168); smile(face, mats, .366, .17, .04); cheeks(face, blush, .127, .38, .157);
    const glint = material('#fff3dc', .18); ball(parts, glint, [-.119, .551, .143], [.027, .061, .006]).rotation.z = -.35;
  } else {
    const vinyl = new T.MeshPhysicalMaterial({ color: data.color, roughness: .38, clearcoat: .35, clearcoatRoughness: .38 });
    box(parts, vinyl, [0, .31, 0], [.43, .40, .32], .095);
    box(parts, vinyl, [0, .63, .012], [.48, .30, .35], .085);
    box(parts, mats.ivory, [0, .635, .19], [.365, .177, .029], .05);
    const panel = material('#4c6960', .66); box(parts, panel, [0, .647, .207], [.31, .13, .013], .035);
    blink = group(body, 0, .665, .218);
    for (const side of [-1, 1]) { box(blink, mats.glow, [side * .075, 0, 0], [.026, .040, .008], .006); cylinder(parts, mats.brass, [side * .26, .39, 0], .07, .08); ball(parts, vinyl, [side * .28, .27, .005], [.06, .12, .068]); box(parts, mats.ivory, [side * .125, .076, .027], [.17, .11, .24], .045); }
    smile(face, { ink: mats.ivory }, .61, .219, .035);
    cylinder(parts, mats.brass, [0, .811, 0], .017, .10); ball(parts, vinyl, [0, .868, 0], [.041, .041, .041]);
    box(parts, mats.ivory, [0, .32, .165], [.21, .15, .021], .025);
    for (let i = 0; i < 3; i++) box(parts, mats.brass, [-.045 + i * .045, .33, .18], [.018, .051, .008], .006);
    ball(parts, mats.red, [.04, .278, .18], [.014, .014, .007]);
  }
  batch(parts); batch(face); if (blink) batch(blink);
  const bounds = new T.Box3().setFromObject(body, true);
  const groundOffset = bounds.min.y;
  body.position.y = -groundOffset;
  root.scale.setScalar(data.scale); root.rotation.y = data.yaw;
  Object.assign(root.userData, { body, articulation, blink, data, face, groundOffset, height: bounds.max.y - bounds.min.y });
  return root;
}
