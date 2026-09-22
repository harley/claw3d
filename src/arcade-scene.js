import * as T from 'three';
import { ToyContacts } from './arcade-contact.js';
import { CabinetHands } from './cabinet-hands.js';
import { JoystickHand } from './joystick-hand.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ASSORTMENT, CAROUSEL, carouselCue, carouselRider, BED, HIGH, FINGER_ANGLES, PHASES, SHELF_LEVELS, collectionSlot, clawPose, mix, ease, clamp } from './arcade-mechanics.js';
import { palette, material, group, mesh, ball, box, cylinder, line, rod, batch, label, createArtMaterials, createToy } from './arcade-art.js';

const v = (x, y, z) => new T.Vector3(x, y, z);

export class ArcadeScene {
  constructor(canvas, { wideControls = false } = {}) {
    this.wideControls = wideControls;
    this.canvas = canvas;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .96;
    this.scene = new T.Scene(); this.scene.background = new T.Color('#080e1c');
    const room = new RoomEnvironment(), pmrem = new T.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, .04); this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .48; room.dispose(); pmrem.dispose();
    this.camera = new T.PerspectiveCamera(35, 1, .1, 70);
    this.home = v(7.25, 6.15, 11.6); this.look = v(-.4, 2.25, 0); this.camera.position.copy(this.home); this.currentLook = this.look.clone();
    this.playLook = v(0, 2.95, 0); this.playCamera = v(0, 0, 0);
    this.angledView = new URLSearchParams(location.search).get('view') === 'angle';
    this.scene.add(new T.HemisphereLight('#fff5e2', '#93a895', 1.15));
    const key = new T.DirectionalLight('#fff0d7', 2.35); key.position.set(-3.5, 8, 5); key.castShadow = true;
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 7, bottom: -5, near: .1, far: 22 }); key.shadow.mapSize.set(2048, 2048); key.shadow.normalBias = .022; key.shadow.bias = -.00015; key.shadow.radius = 3; this.scene.add(key);
    const rim = new T.DirectionalLight('#dceee3', 1.65); rim.position.set(4, 5, -4); this.scene.add(rim);
    const front = new T.DirectionalLight('#ffe8df', .5); front.position.set(0, 3, 7); this.scene.add(front);
    this.mats = createArtMaterials(); this.toys = new Map(); this.buildWorld(); this.buildCabinet(); this.buildClaw();
    for (const toy of ASSORTMENT) { const object = createToy(toy, this.mats); object.position.set(toy.x, BED, toy.z); this.scene.add(object); this.toys.set(toy.id, object); }
    this.contacts = new ToyContacts(this.toys);
    if (wideControls) this.cabinetHands = new CabinetHands(this.scene);
    this.buildCarousel();
    this.createTarget();
    this.buildEffects();
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)'); this.reducedMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener('change', e => { this.reducedMotion = e.matches; });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement); this.observer.observe(canvas); this.resize();
    this.time = 0; this.lowQuality = false; this.disposed = false;
  }

  buildWorld() {
    const m = this.mats, world = this.surroundings = group(this.scene);
    const ground = mesh(this.scene, new T.PlaneGeometry(200, 200), new T.MeshBasicMaterial({ color: '#080e1c', toneMapped: false })); ground.rotation.x = -Math.PI / 2; ground.position.y = -.055; ground.castShadow = false;
    const shadow = mesh(this.scene, new T.PlaneGeometry(200, 200), new T.ShadowMaterial({ opacity: .16 })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.05; shadow.castShadow = false;
    box(world, material('#142c50', .88), [-.55, .12, .12], [7.75, .33, 4.7], .23);
    box(world, m.ivory, [-.55, .285, .12], [7.64, .065, 4.58], .2);
    // Warm miniature parquet, with real, restrained seams.
    const tiles = ['#20344c', '#1b2d45', '#253b55', '#172a40'].map(tone => material(tone, .87));
    for (let x = 0; x < 12; x++) for (let z = 0; z < 5; z++) {
      box(world, tiles[(x * 3 + z) % 4], [-4.0 + x * .635, .328, -1.70 + z * .86], [.628, .024, .852], .008);
    }
    // Gallery: eleven full-size toys, collected across four shelves.
    const shelf = group(world, -2.92, 0, -.16);
    for (const x of [-1.04, 1.04]) { box(shelf, m.wood, [x, 2.50, 0], [.105, 4.29, .62], .028); box(shelf, m.brass, [x, .47, .06], [.12, .25, .13], .025); }
    box(shelf, material('#aa9478'), [0, 2.56, -.29], [2.08, 4.00, .07], .025);
    for (const level of SHELF_LEVELS) { box(shelf, m.wood, [0, level - .05, .28], [2.18, .10, .86], .025); box(shelf, m.brass, [0, level, .65], [2.12, .025, .025], .008); }
    box(shelf, m.ivory, [0, 4.65, .06], [2.18, .24, .64], .055);
    label(shelf, 'PRIZES', 1.95, .15, [0, 4.66, .388], { color: '#625d4d', font: 'Arial', size: 29, tracking: 2.5 });
    box(shelf, m.ivory, [.67, 2.64, .30], [.40, .29, .07], .025);
    // A little lamp and its pool of light.
    const lamp = group(world, 2.28, .35, -.42);
    cylinder(lamp, m.brass, [0, .06, 0], .34, .12); cylinder(lamp, m.brass, [0, 1.57, 0], .037, 3.03);
    mesh(lamp, new T.ConeGeometry(.56, .59, 40, 1, true), m.red, 0, 3.24, 0);
    cylinder(lamp, m.glow, [0, 2.97, 0], .47, .018); ball(lamp, m.brass, [0, 3.565, 0], [.06, .055, .06]);
    const light = new T.PointLight('#ffe5b4', 3.5, 5, 2); light.position.set(2.28, 3.15, -.42); this.scene.add(light);
    // A tiny stool and a saucer of tokens establish the scale.
    const stool = group(world, 2.46, .35, 1.13);
    cylinder(stool, m.red, [0, .66, 0], .40, .13, 48); cylinder(stool, m.ivory, [0, .585, 0], .365, .035);
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; rod(stool, m.wood, [Math.cos(a) * .25, .55, Math.sin(a) * .25], [Math.cos(a) * .34, 0, Math.sin(a) * .34], .04); }
    const dish = group(world, 1.98, .35, 1.62);
    cylinder(dish, m.mint, [0, .05, 0], .25, .075, 48);
    const rim = mesh(dish, new T.TorusGeometry(.233, .027, 8, 40), m.mint, 0, .096, 0); rim.rotation.x = Math.PI / 2;
    for (let i = 0; i < 7; i++) { const token = cylinder(dish, m.brass, [Math.sin(i * 5) * .11, .10 + i * .009, Math.cos(i * 5) * .1], .073, .015); token.rotation.z = Math.sin(i) * .13; }
    // A small illustrated postcard, original cloud mark and a potted sprig.
    const card = group(world, 2.68, 1.13, 1.10); box(card, m.ivory, [0, 0, 0], [.29, .40, .025], .012); card.rotation.y = -.15; card.rotation.x = -.15;
    // Keep decoration outside the courier lane along the front of the gallery.
    const pot = group(world, 2.95, .35, -.95); mesh(pot, new T.CylinderGeometry(.17, .13, .23, 24), m.red, 0, .115, 0); cylinder(pot, material('#614d3d'), [0, .235, 0], .145, .01);
    const leafMat = material('#6a8d69', .84);
    for (let i = 0; i < 5; i++) { const a = i * 2.4, x = Math.sin(a) * .16, z = Math.cos(a) * .16; rod(pot, leafMat, [0, .23, 0], [x, .46 + i * .037, z], .008); const leaf = ball(pot, leafMat, [x, .46 + i * .037, z], [.065, .14, .027]); leaf.rotation.set(.3, a, .6); }
    // Preserve geometry bounds before static batching removes individual meshes.
    this.deliveryObstacles = Object.fromEntries(Object.entries({ plant: pot, lamp, stool, tokens: dish, postcard: card }).map(([name, object]) => [name, new T.Box3().setFromObject(object, true)]));
    batch(world);
  }

  buildCabinet() {
    const m = this.mats, cab = group(this.scene);
    // Stacked enamel shell, inset mint panels and champagne reveals.
    // Stop below the wooden outlet floor (y=.50). Coplanar top faces made
    // the red plinth flicker through the wood during delivery camera motion.
    box(cab, m.red, [0, .415, 0], [3.70, .13, 2.70], .065);
    box(cab, m.ivory, [0, .96, -1.21], [3.55, .96, .15], .065);
    for (const x of [-1.71, 1.71]) box(cab, m.ivory, [x, .96, 0], [.14, .96, 2.55], .055);
    box(cab, m.ivory, [.67, .96, 1.20], [2.08, .96, .16], .075);
    box(cab, m.red, [.65, 1.43, .01], [2.40, .17, 2.68], .06);
    box(cab, m.red, [-1.78, 1.43, .01], [.14, .17, 2.68], .045);
    box(cab, m.red, [-1.15, 1.43, -.73], [1.12, .17, 1.19], .04);
    box(cab, m.brass, [.61, 1.535, .01], [2.32, .035, 2.55], .012);
    box(cab, m.mint, [0, 3.06, -1.24], [3.34, 3.07, .12], .03);
    box(cab, m.paleMint, [0, 3.20, -1.155], [3.15, 2.61, .035], .08);
    // Quiet scalloped interior wallpaper and small stars.
    const mural = material('#a9c6b6', .94);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) {
      const x = -1.36 + col * .385 + (row % 2) * .06, y = 2.17 + row * .44;
      const star = mesh(cab, new T.CircleGeometry(.022, 4), mural, x, y, -1.13); star.rotation.z = .0;
    }
    for (const x of [-1.73, 1.73]) for (const z of [-1.25, 1.25]) {
      box(cab, m.ivory, [x, 3.045, z], [.16, 3.02, .17], .047);
      box(cab, m.brass, [x, 3.00, z + (z > 0 ? .087 : -.087)], [.035, 2.80, .025], .01);
      for (const y of [1.67, 4.43]) { const screw = cylinder(cab, m.brass, [x, y, z + .10], .025, .013, 16); screw.rotation.x = Math.PI / 2; line(cab, m.darkMetal, [[x - .013, y, z + .11], [x + .013, y, z + .11]], .0025); }
    }
    // Bed leaves a real opening at the front-left for the prize chute.
    box(cab, m.paleMint, [.49, 1.607, 0], [2.35, .105, 2.37], .05);
    box(cab, m.paleMint, [-1.15, 1.607, -.49], [.93, .105, 1.39], .045);
    box(cab, m.mint, [-1.20, 1.59, 1.10], [1.01, .13, .12], .02);
    box(cab, m.brass, [-.646, 1.625, .68], [.035, .045, .79], .012);
    box(cab, m.brass, [-1.15, 1.625, .278], [.98, .045, .035], .012);
    this.hatch = group(this.scene, -1.15, BED, .28);
    box(this.hatch, m.mint, [0, -.055, .39], [.97, .10, .78], .025);
    // Lower front: inset collection hatch and a small service panel.
    for (const x of [-1.65, -.49]) box(cab, m.red, [x, 1.00, 1.28], [.09, 1.03, .12], .032);
    box(cab, m.red, [-1.07, 1.535, 1.28], [1.24, .072, .12], .025);
    box(cab, m.rubber, [-1.07, .92, .15], [1.07, .84, .025], .04);
    box(cab, m.wood, [-1.07, .47, 1.11], [1.10, .06, 1.49], .025);
    box(cab, m.mint, [.79, .92, 1.275], [1.08, .57, .028], .035);
    for (let i = 0; i < 6; i++) box(cab, m.darkMetal, [.79, .82 + i * .042, 1.293], [.54, .009, .009], .004);
    ball(cab, m.brass, [1.18, 1.09, 1.30], [.025, .025, .010]);
    // Control deck: ivory over red, a ball-topped stick, one big enamel button.
    const stickX = this.wideControls ? -1.28 : -.28, dropX = this.wideControls ? 1.28 : .87;
    box(cab, m.red, [this.wideControls ? 0 : .55, 1.525, 1.44], [this.wideControls ? 3.5 : 2.08, .18, .53], .065);
    box(cab, this.wideControls ? material('#203346', .32, .3) : m.ivory, [this.wideControls ? 0 : .55, 1.633, 1.44], [this.wideControls ? 3.43 : 2.01, .045, .49], .045);
    cylinder(cab, m.brass, [stickX, 1.68, 1.44], .155, .023); cylinder(cab, m.rubber, [stickX, 1.70, 1.44], .09, .018);
    this.stick = group(this.scene, stickX, 1.70, 1.44); cylinder(this.stick, m.chrome, [0, .092, 0], .023, .18); ball(this.stick, this.wideControls ? new T.MeshPhysicalMaterial({color:'#147c91',roughness:.18,metalness:.12,clearcoat:1,clearcoatRoughness:.12}) : m.red, [0, .205, 0], [.10, .10, .10]);
    this.stick.scale.setScalar(1.4);
    this.joystickHand = new JoystickHand(this.stick);
    cylinder(cab, m.brass, [dropX, 1.675, 1.44], this.wideControls ? .235 : .19, .036);
    if (this.wideControls) cylinder(cab, m.rubber, [dropX, 1.705, 1.44], .218, .024);
    this.button = this.wideControls
      ? mesh(this.scene, new T.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), m.red.clone(), dropX, 1.72, 1.44)
      : cylinder(this.scene, m.red.clone(), [dropX, 1.72, 1.44], .21, .10, 48);
    if (this.wideControls) {
      this.button.scale.set(.21, .135, .21);
      this.button.material.dispose();
      this.button.material = new T.MeshPhysicalMaterial({ color:'#ed941d',roughness:.18,metalness:.12,clearcoat:1,clearcoatRoughness:.1 });
      const capLabel = label(cab, 'DROP', .28, .085, [dropX, 1.665, 1.77], { color: '#e1d6ba', font: 'Arial', weight: 'bold', size: 155 }); capLabel.rotation.x = -Math.PI / 2;
    } else {
      const capLabel = label(this.button, 'DROP', .28, .10, [0, .054, 0], { color: '#fff4dd', font: 'Arial', weight: 'bold', size: 155 }); capLabel.rotation.x = -Math.PI / 2;
    }
    const aimLabel = label(cab, 'MOVE', .28, .075, [stickX + .33, 1.66, 1.47], { color: this.wideControls ? '#e1d6ba' : '#716b57', font: 'Arial', size: 30 }); aimLabel.rotation.x = -Math.PI / 2;
    if (!this.wideControls) { const dropLabel = label(cab, 'DROP', .28, .075, [dropX + (this.wideControls ? -.33 : .33), 1.66, 1.47], { color: '#a04540', font: 'Arial', size: 30 }); dropLabel.rotation.x = -Math.PI / 2; }
    // Lantern-like marquee and tiny edge bulbs.
    box(cab, m.ivory, [0, 4.61, 0], [3.78, .24, 2.75], .12);
    box(cab, m.red, [0, 4.94, .00], [3.83, .57, 2.73], .15);
    box(cab, m.brass, [0, 4.946, 1.373], [3.39, .433, .022], .09);
    box(cab, m.ivory, [0, 4.946, 1.394], [3.32, .367, .018], .08);
    label(cab, 'CLAW', 2.62, .29, [0, 4.965, 1.408], { color: '#e52948', font: 'Arial', weight: 'bold', size: 59 });
    for (const x of [-1.54, 1.54]) ball(cab, m.glow, [x, 4.957, 1.413], [.035, .035, .019]);
    // Original cloud finial; silhouette stays readable at a distance.
    for (const [x, y, r] of [[-.29, 5.337, .15], [-.08, 5.397, .22], [.17, 5.364, .18], [.33, 5.315, .11]]) ball(cab, m.ivory, [x, y, .03], [r, r, .12]);
    box(cab, m.ivory, [.005, 5.275, .03], [.71, .13, .22], .06);
    for (const x of [-.09, .09]) ball(cab, m.red, [x, 5.344, .15], [.017, .024, .009]);
    // Visible mechanics, rails, bearings and carriage drive.
    for (const x of [-1.51, 1.51]) { cylinder(cab, m.chrome, [x, 4.42, 0], .028, 2.39).rotation.x = Math.PI / 2; box(cab, m.darkMetal, [x, 4.48, 0], [.07, .045, 2.36], .01); }
    for (const z of [-1.05, 1.05]) box(cab, m.glow, [0, 4.48, z], [2.88, .025, .034], .009);
    for (const x of [-1.758, 1.758]) for (const y of [2.08, 3.93]) box(cab, m.brass, [x, y, 1.16], [.045, .16, .09], .012);
    batch(cab);
    // Marquee bulb row: one instanced draw call, per-bulb color for chases.
    // Kept out of the static batch so instance colors stay addressable.
    this.marqueeBulbs = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), new T.MeshBasicMaterial({ toneMapped: false }), 11);
    this.marqueeBulbs.castShadow = this.marqueeBulbs.receiveShadow = false;
    const bulb = new T.Object3D();
    for (let i = 0; i < 11; i++) {
      bulb.position.set(-1.5 + i * .3, 5.19, 1.375); bulb.scale.set(.030, .030, .015); bulb.updateMatrix();
      this.marqueeBulbs.setMatrixAt(i, bulb.matrix);
      this.marqueeBulbs.setColorAt(i, new T.Color('#8a7452'));
    }
    this.scene.add(this.marqueeBulbs);
    this.outletFlap = group(this.scene, -1.07, 1.50, 1.37);
    const flapGlass = new T.MeshPhysicalMaterial({ color: '#c4d9cd', transparent: true, opacity: .23, roughness: .21, metalness: .16, side: T.DoubleSide, depthWrite: false });
    const flap = mesh(this.outletFlap, new T.PlaneGeometry(1.03, .95), flapGlass, 0, -.475, 0); flap.castShadow = false;
    line(this.outletFlap, m.brass, [[-.515, 0, 0], [-.515, -.95, 0], [.515, -.95, 0], [.515, 0, 0]], .009);
    for (const x of [-.38, .38]) { const hinge = cylinder(this.outletFlap, m.brass, [x, 0, 0], .024, .16, 16); hinge.rotation.z = Math.PI / 2; }
    // Side glazing and fine front reflections: transparent, never a milky wall.
    const glazing = group(this.scene);
    for (const x of [-1.722, 1.722]) { const panel = mesh(glazing, new T.PlaneGeometry(2.40, 2.80), m.glass, x, 3.03, 0); panel.rotation.y = Math.PI / 2; panel.castShadow = false; }
    const glassEdge = new T.MeshBasicMaterial({ color: '#edf6e9', transparent: true, opacity: .38, depthWrite: false });
    line(glazing, glassEdge, [[1.625, 1.78, 1.25], [1.625, 4.37, 1.25]], .009);
    line(glazing, glassEdge, [[-1.64, 4.38, 1.25], [1.64, 4.38, 1.25]], .008);
    for (const x of [1.70]) { const sheen = mesh(glazing, new T.PlaneGeometry(.16, 1.85), glassEdge, x, 3.1, -.50); sheen.rotation.y = Math.PI / 2; sheen.rotation.x = .18; sheen.castShadow = false; }
    this.deliveryTray = group(this.scene); box(this.deliveryTray, m.mint, [0, -.035, 0], [.68, .065, .58], .035); box(this.deliveryTray, m.brass, [0, -.008, .27], [.62, .026, .023], .01); this.deliveryTray.visible = false;
    this.courier = group(this.scene); box(this.courier, m.red, [0, .39, 0], [.48, .09, .40], .035);
    for (const x of [-.20, .20]) for (const z of [-.14, .14]) { const wheel = cylinder(this.courier, m.rubber, [x, .37, z], .045, .035, 12); wheel.rotation.z = Math.PI / 2; }
    this.courierMast = cylinder(this.courier, m.brass, [0, .6, 0], .027, 1, 16); this.courierArm = cylinder(this.courier, m.chrome, [0, .8, 0], .021, 1, 12); this.courierArm.rotation.x = Math.PI / 2;
    this.courier.visible = false;
  }

  buildClaw() {
    const m = this.mats;
    this.bridge = group(this.scene); box(this.bridge, m.ivory, [0, 4.385, 0], [3.16, .115, .16], .025);
    cylinder(this.bridge, m.chrome, [0, 4.305, 0], .022, 3.12).rotation.z = Math.PI / 2;
    for (const x of [-1.50, 1.50]) box(this.bridge, m.darkMetal, [x, 4.40, 0], [.17, .14, .25], .025);
    batch(this.bridge);
    this.carriage = group(this.scene); box(this.carriage, m.red, [0, 4.33, 0], [.39, .15, .34], .055); box(this.carriage, m.brass, [0, 4.225, 0], [.25, .045, .23], .018);
    for (const x of [-.21, .21]) for (const z of [-.11, .11]) { const wheel = cylinder(this.carriage, m.rubber, [x, 4.37, z], .048, .045, 16); wheel.rotation.z = Math.PI / 2; }
    batch(this.carriage);
    this.cable = cylinder(this.scene, m.darkMetal, [0, 4.1, 0], .014, 1, 12);
    this.claw = group(this.scene);
    cylinder(this.claw, m.brass, [0, .04, 0], .058, .10); cylinder(this.claw, m.ivory, [0, -.055, 0], .132, .16, 40);
    cylinder(this.claw, m.red, [0, -.126, 0], .136, .045, 40); cylinder(this.claw, m.chrome, [0, -.167, 0], .093, .032);
    const hub = group(this.claw); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ball(hub, m.brass, [Math.cos(a) * .132, -.055, Math.sin(a) * .132], [.014, .014, .014]); } batch(hub);
    this.fingers = FINGER_ANGLES.map(angle => {
      const root = group(this.claw); root.rotation.y = -angle;
      const shoulder = [ .11, -.145, 0 ];
      const upper = cylinder(root, m.chrome, [0, 0, 0], .022, 1, 12), lower = cylinder(root, m.chrome, [0, 0, 0], .022, 1, 12);
      const tendon = cylinder(root, m.brass, [0, 0, 0], .009, 1, 8);
      ball(root, m.brass, shoulder, [.039, .039, .039]); const elbow = ball(root, m.brass, [0, 0, 0], [.038, .038, .038]);
      const pad = box(root, m.rubber, [0, 0, 0], [.078, .033, .058], .015);
      return { root, shoulder, upper, lower, tendon, elbow, pad };
    });
  }

  buildCarousel() {
    const m = this.mats;
    this.carousel = group(this.scene, CAROUSEL.x, BED, CAROUSEL.z);
    cylinder(this.carousel, m.darkMetal, [0, .045, 0], .56, .09, 64);
    cylinder(this.carousel, m.brass, [0, .09, 0], .55, .025, 64);
    this.carouselDeck = group(this.carousel);
    cylinder(this.carouselDeck, m.red, [0, .13, 0], .53, .06, 64);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      const stripe = box(this.carouselDeck, m.ivory, [Math.cos(angle) * .46, .163, Math.sin(angle) * .46], [.075, .008, .025], .004); stripe.rotation.y = -angle;
    }
    cylinder(this.carouselDeck, m.brass, [0, .17, 0], .09, .025, 24);
    batch(this.carouselDeck); // The deck rotates as one rigid object.
    const ring = mesh(this.carousel, new T.RingGeometry(.19, .21, 48), new T.MeshBasicMaterial({ color: '#ffc14d', side: T.DoubleSide }), 0, .168, CAROUSEL.radius); ring.rotation.x = -Math.PI / 2;
    // Signals sit in the front fascia, below the toy and claw travel envelope.
    // A fixed traffic-light signal beside the track, independent of deck rotation.
    const panel = group(this.carousel, 0, .075, .555);
    box(panel, m.darkMetal, [0, 0, 0], [.64, .13, .035], .035);
    this.carouselLights = [-.20, 0, .20].map(x => {
      const mat = new T.MeshStandardMaterial({ color: '#3e3426', emissive: '#ffb52b', emissiveIntensity: 0, roughness: .4 });
      return ball(panel, mat, [x, 0, .025], [.038, .038, .014]);
    });

  }

  createTarget() {
    this.target = group(this.scene);
    this.targetMat = new T.MeshBasicMaterial({ color: '#be5a4e', transparent: true, opacity: .80, depthWrite: false });
    const ring = mesh(this.target, new T.RingGeometry(.16, .172, 64), this.targetMat); ring.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 4; i++) { const tick = box(this.target, this.targetMat, [Math.cos(i * Math.PI / 2) * .227, 0, Math.sin(i * Math.PI / 2) * .227], [.09, .008, .016], .005); tick.rotation.y = -i * Math.PI / 2; }
    batch(this.target);
    this.target.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = false; });
    this.beamMat = new T.LineBasicMaterial({ color: '#698d79', transparent: true, opacity: .34, depthWrite: false });
    this.beam = new T.Line(new T.BufferGeometry().setFromPoints([v(0, 0, 0), v(0, 1, 0)]), this.beamMat); this.scene.add(this.beam);
  }

  buildEffects() {
    // Catch payoff: one instanced mesh, one draw call, CPU-driven particles.
    this.burst = new T.InstancedMesh(new T.BoxGeometry(.05, .028, .01), new T.MeshBasicMaterial({ toneMapped: false }), 150);
    this.burst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.burst.castShadow = this.burst.receiveShadow = false;
    this.burst.frustumCulled = false;
    this.burst.count = 0; this.burst.visible = false;
    this.scene.add(this.burst);
    this.burstParticles = []; this.burstDummy = new T.Object3D();
    this.lastPhase = '';
    this.punch = null;
    this.attractBlend = 0;
  }

  // A short decaying camera punch: contact, catch and the shelf landing each
  // give the viewpoint a physical kick. Off under reduced motion.
  kick(amplitude, at) { if (!this.reducedMotion) this.punch = { amplitude, at }; }
  punchOffset(time) {
    if (!this.punch) return 0;
    const t = time - this.punch.at;
    if (t < 0 || t > .6) { this.punch = null; return 0; }
    return this.punch.amplitude * Math.exp(-t * 9) * Math.sin(t * 45);
  }

  spawnBurst(origin, star) {
    const colors = (star ? ['#ffd75e', '#fff3c4', '#e82447', '#8de0c8', '#f5ac84'] : ['#e82447', '#e8edf4', '#c6a46a', '#8de0c8']).map(c => new T.Color(c));
    const count = star ? 140 : 80;
    this.burstParticles = Array.from({ length: count }, (_, i) => {
      const a = Math.random() * Math.PI * 2, r = (.5 + Math.random() * 1.2) * (star ? 1.3 : 1);
      this.burst.setColorAt(i, colors[i % colors.length]);
      return {
        position: origin.clone().add(v((Math.random() - .5) * .2, Math.random() * .12, (Math.random() - .5) * .2)),
        velocity: v(Math.cos(a) * r, 1.7 + Math.random() * 2.1, Math.sin(a) * r),
        rotation: v(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
        spin: v((Math.random() - .5) * 14, (Math.random() - .5) * 14, (Math.random() - .5) * 14),
        life: .95 + Math.random() * .45,
      };
    });
    this.burst.count = count; this.burst.visible = true;
    this.burst.instanceColor.needsUpdate = true;
  }

  updateBurst(dt) {
    let alive = 0;
    const d = this.burstDummy;
    this.burstParticles.forEach((p, i) => {
      p.life -= dt;
      const fade = clamp(p.life / .3, 0, 1);
      if (p.life > 0) alive++;
      p.velocity.y -= dt * 5.2; p.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.1));
      p.position.addScaledVector(p.velocity, dt);
      p.rotation.addScaledVector(p.spin, dt);
      d.position.copy(p.position); d.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
      d.scale.setScalar(Math.max(.0001, fade));
      d.updateMatrix();
      this.burst.setMatrixAt(i, d.matrix);
    });
    this.burst.instanceMatrix.needsUpdate = true;
    if (!alive) { this.burst.visible = false; this.burst.count = 0; this.burstParticles = []; }
  }

  updateMarquee(phase, plan, time, motion, attract = false) {
    const palette = this.marqueePalette ??= { dim: new T.Color('#5a4a33'), warm: new T.Color('#e8bd7a'), bright: new T.Color('#ffe9b0') };
    const delivering = Boolean(plan?.prize) && ['transfer', 'release', 'deliver', 'reveal'].includes(phase);
    const jackpot = delivering && phase === 'reveal' && plan.prize.family === 'star';
    // Repaint and re-upload only when the lit pattern actually changes.
    const rate = attract ? 6 : 2.5;
    const key = jackpot ? `j${motion ? Math.floor(time * 14) % 2 : 's'}`
      : delivering ? `d${motion ? Math.floor(time * 8) % 3 : 's'}`
      : phase === 'idle' ? `i${motion ? Math.floor(time * rate) % 5 : 's'}`
      : 'rest';
    if (key === this.marqueeKey) return;
    this.marqueeKey = key;
    for (let i = 0; i < 11; i++) {
      const color = jackpot ? (!motion || (time * 14 + i) % 2 < 1 ? palette.bright : palette.dim)
        : delivering ? (!motion || (i - Math.floor(time * 8)) % 3 === 0 ? palette.bright : palette.dim)
        : phase === 'idle' ? (motion ? (i - Math.floor(time * rate)) % 5 === 0 ? palette.warm : palette.dim : palette.warm)
        : palette.dim;
      this.marqueeBulbs.setColorAt(i, color);
    }
    this.marqueeBulbs.instanceColor.needsUpdate = true;
  }

  resize() {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.viewport = { width, height };
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    const extra = Math.max(1, 1.45 / this.camera.aspect); this.home.set(7.25 * extra, 2.25 + 3.90 * extra, 11.6 * extra);
    const playScale = Math.max(1, 1.05 / this.camera.aspect);
    this.playCamera.set((this.angledView ? 1.8 : .45) * playScale, 2.95 + 1.85 * playScale, 6.4 * playScale);
  }

  setQuality(low) { this.lowQuality = low; this.renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 1.5)); this.renderer.shadowMap.enabled = !low; this.resize(); }

  controlTargets() {
    const stick = this.stick.localToWorld(v(0, .205, 0));
    const dropX = this.button.position.x;
    const radius = Math.abs(this.screenPoint(dropX + .25, 1.77, 1.44).x - this.screenPoint(dropX, 1.77, 1.44).x);
    const { left, right, top, bottom } = this.canvas.getBoundingClientRect();
    return { bounds: { left, right, top, bottom }, stick: { ...this.screenPoint(stick.x, stick.y, stick.z), radius: Math.max(32, radius * 1.3), ballRadius: Math.abs(this.screenPoint(stick.x + .14, stick.y, stick.z).x - this.screenPoint(stick.x, stick.y, stick.z).x) },
      drop: { ...this.screenPoint(dropX, this.button.position.y + (this.wideControls ? .115 : .05), 1.44), radius: Math.max(26, radius), ready: Boolean(this.dropReady) } };
  }

  screenPoint(x, y, z) { const p = v(x, y, z).project(this.camera), rect = this.canvas.getBoundingClientRect(); return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height }; }

  groundToys(game) { for (const toy of game.toys) toy.groundOffset = this.toys.get(toy.id).userData.groundOffset; }
  toyBounds(id) { const bounds = new T.Box3().setFromObject(this.toys.get(id), true); return { min: bounds.min.toArray(), max: bounds.max.toArray() }; }

  applyClawPose(pose) {
    this.bridge.position.z = pose.z; this.carriage.position.set(pose.x, 0, pose.z);
    this.claw.position.set(pose.x, pose.y, pose.z);
    this.cable.position.set(pose.x, (4.21 + pose.y + .09) / 2, pose.z); this.cable.scale.y = Math.max(.025, 4.21 - pose.y - .09);
    const setBone = (bone, a, b) => { const delta = v(...b).sub(v(...a)); bone.position.copy(v(...a).add(v(...b)).multiplyScalar(.5)); bone.scale.y = delta.length(); bone.quaternion.setFromUnitVectors(v(0, 1, 0), delta.normalize()); };
    this.fingers.forEach((finger, i) => {
      const radius = pose.radii[i], elbow = [mix(.29, .365, (radius - .075) / .335), -.52, 0], tip = [radius, -.965, 0];
      setBone(finger.upper, finger.shoulder, elbow); setBone(finger.lower, elbow, tip);
      setBone(finger.tendon, [.075, -.14, .025], [elbow[0] - .025, elbow[1] + .022, .025]);
      finger.elbow.position.set(...elbow); finger.pad.position.set(radius - .017, -.976, 0);
    });
  }

  updateClawFeedback(pose, phase, dt, feedback, holding) {
    // Rendering only: contacts have already resolved from the unmodified pose.
    this.applyClawPose(holding ? { ...pose, radii: pose.radii.map(r => Math.max(.06, r - .22 * ease(holding))) } : pose);
    const steering = phase === 'aim' && feedback.controlEnabled && feedback.kind === 'tracking';
    const previous = this.previousAim;
    const lean = delta => Math.abs(delta) < .08 ? 0 : clamp(delta * .035, -.035, .035);
    this.claw.rotation.set(0, 0, 0);
    if (steering && previous && dt > 0 && !this.reducedMotion) {
      this.claw.rotation.x = lean((pose.z - previous.z) / dt);
      this.claw.rotation.z = -lean((pose.x - previous.x) / dt);
    }
    // Actual travel, not raw hand jitter. No accumulated sway or trailing spring;
    // stopping, hitting a limit, clenching or losing control returns to neutral.
    this.previousAim = steering ? { x: pose.x, z: pose.z } : null;
  }

  update(game, dt, time, input, aligned, feedback = {}, cameraActive = false, presentation = {}) {
    const phase = game.phase, elapsed = game.elapsed, plan = game.plan, motion = this.reducedMotion ? 0 : 1;
    this.carousel.visible = Boolean(game.carousel);
    if (game.carousel) {
      this.carouselDeck.rotation.y = -game.carouselTime / CAROUSEL.period * Math.PI * 2;
      const cue = carouselCue(game.carouselTime, presentation.cueLead);
      const starAvailable = Boolean(carouselRider(game));
      this.carouselLights.forEach((light, i) => { const on = starAvailable && ['idle', 'aim'].includes(game.phase) && i < cue.lights; light.material.color.set(on ? cue.now ? '#66ffb3' : '#ffc14d' : '#3e3426'); light.material.emissive.set(cue.now ? '#33ff99' : '#ffb52b'); light.material.emissiveIntensity = on ? 2 : 0; });
    }
    for (const [id, object] of this.toys) object.visible = game.toys.some(toy => toy.id === id);
    const pose = clawPose(game);
    this.stick.rotation.set(input.z * .24, 0, -input.x * .24); this.button.position.y = 1.72 - .05 * (phase === 'anticipate' ? 1 : phase === 'descend' ? Math.max(0, 1 - elapsed / .18) : 0);
    this.joystickHand.update(phase, elapsed, dt, feedback, this.reducedMotion);
    this.stick.visible = this.button.visible = presentation.machineControls || ['idle', 'result'].includes(phase);
    if (presentation.machineControls && ['dual', 'grab-release'].includes(feedback.profile)) this.joystickHand.root.visible = false;
    if (presentation.machineControls && phase === 'aim' && feedback.grab?.stage === 'pressing') this.button.position.y -= .04 * feedback.progress;
    const activeControl = phase === 'aim' && feedback.controlEnabled && ['tracking', 'clenching'].includes(feedback.kind);
    this.dropReady = Boolean(activeControl && (feedback.profile === 'dual'
      ? feedback.dropEnabled && feedback.hands?.right?.ready && feedback.hands.right.grab?.armed
      : feedback.profile === 'grab-release' ? feedback.grab?.armed && feedback.target === 'drop' : feedback.kind === 'clenching'));
    this.button.material.emissive.set('#ffb52b'); this.button.material.emissiveIntensity = this.dropReady ? .55 : 0;
    if (presentation.machineControls && activeControl && !['dual', 'grab-release'].includes(feedback.profile)) this.button.position.y -= .04 * (feedback.progress || 0);
    this.cabinetHands?.update(phase, elapsed, dt, feedback, presentation.machineControls, this.stick, this.button, this.reducedMotion);
    this.target.visible = ['idle', 'aim'].includes(phase); this.target.position.set(game.position.x, BED + (game.carousel && Math.hypot(game.position.x - CAROUSEL.x, game.position.z - CAROUSEL.z) < .55 ? CAROUSEL.height : 0) + .014, game.position.z); this.targetMat.color.set(aligned ? '#547e69' : '#bb5b49');
    // Fist-hold confirmation fills the ring the player is already watching.
    const holding = !['grab-release', 'dual'].includes(feedback.profile) && phase === 'aim' && feedback.controlEnabled && feedback.kind === 'clenching' ? clamp(feedback.progress, 0, 1) : 0;
    this.beam.visible = this.target.visible; this.beam.position.set(game.position.x, BED + .02, game.position.z); this.beam.scale.y = HIGH - BED - 1.01; this.beamMat.color.copy(this.targetMat.color);
    this.deliveryTray.visible = false; this.deliveryTray.scale.setScalar(1);
    const hatchOpen = plan?.prize && ['release', 'deliver', 'reveal', 'result'].includes(phase);
    this.hatch.rotation.x = hatchOpen ? (phase === 'release' ? ease(elapsed / .18) : 1) * Math.PI / 2 : phase === 'idle' ? 0 : Math.max(0, this.hatch.rotation.x - dt * 9);
    const delivery = phase === 'deliver' && plan?.prize ? elapsed / PHASES.deliver : -1;
    this.outletFlap.rotation.x = delivery >= 0 ? -Math.PI / 2 * ease(delivery / .22) * (1 - ease((delivery - .65) / .22)) : 0;
    for (const toy of game.toys) {
      const object = this.toys.get(toy.id), { body, articulation, blink, wave, waveTime, face } = object.userData;
      object.position.set(toy.x, BED + (toy.elevation || 0), toy.z); object.rotation.set(0, toy.yaw, 0); object.scale.setScalar(toy.scale); body.scale.set(1, 1, 1); body.rotation.set(0, 0, 0);
      const index = game.collection.indexOf(toy.id);
      if (index >= 0) { const slot = collectionSlot(toy.id); object.position.set(slot.x, slot.y, slot.z); object.rotation.y = .35; }
      const held = plan?.prize?.id === toy.id;
      const affected = plan?.touched?.id === toy.id;
      let compression = 0, wobble = 0;
      if (affected && phase === 'grip') compression = ease(elapsed / PHASES.grip) * (toy.family === 'star' ? .14 : toy.family === 'robot' ? .018 : .085);
      if (held && ['lift', 'transfer', 'release'].includes(phase)) {
        object.position.set(pose.x + plan.offset.x, pose.y - plan.offset.y, pose.z + plan.offset.z);
        compression = toy.family === 'star' ? .09 : toy.family === 'robot' ? .01 : .042;
        const progress = elapsed / PHASES[phase]; wobble = motion * Math.sin(progress * Math.PI * 2) * (toy.family === 'star' ? .10 : .032) * Math.sin(progress * Math.PI);
        if (phase === 'release') { const fall = clamp((elapsed - .18) / .37, 0, 1) * .28; object.position.y = mix(HIGH - plan.offset.y, .50, fall * fall); compression *= 1 - ease(progress); }
      }
      if (held && phase === 'deliver') {
        const t = clamp(elapsed / PHASES.deliver, 0, 1), slot = collectionSlot(toy.id), startY = HIGH - plan.offset.y, chuteX = pose.x + plan.offset.x, chuteZ = pose.z + plan.offset.z;
        // A continuous gravity fall into the hatch, followed by a supported
        // miniature courier platform to the gallery. The prize keeps its size.
        if (t < .24) { const fall = mix(.28, 1, t / .24); object.position.set(chuteX, mix(startY, .50, fall * fall), chuteZ); }
        else if (t < .40) { const slide = ease((t - .24) / .16); object.position.set(mix(chuteX, -1.08, slide), .50, mix(chuteZ, 1.69, slide)); }
        else {
          const courier = (t - .40) / .60, across = ease(courier / .5), rise = ease((courier - .38) / .35), insert = ease((courier - .70) / .30);
          object.position.set(mix(-1.08, slot.x, across), mix(.50, slot.y, rise) + Math.sin(insert * Math.PI) * .06, mix(1.69, slot.z, insert));
          // Reveal the tray after it starts clearing the outlet. A full-size tray
          // appearing behind the open flap in one frame reads as a flickering ramp.
          const trayReveal = ease((courier - .04) / .14);
          this.deliveryTray.visible = trayReveal > 0; this.deliveryTray.scale.setScalar(Math.max(.001, trayReveal)); this.deliveryTray.position.copy(object.position);
          compression = Math.sin(Math.min(1, courier * 8) * Math.PI) * (toy.family === 'robot' ? .015 : toy.family === 'star' ? .14 : .10);
        }
        object.rotation.y = mix(toy.yaw, .35, ease(t)); wobble = motion * Math.sin(t * 25) * .07 * Math.sin(t * Math.PI);
      }
      if (held && ['reveal', 'result'].includes(phase)) {
        wobble = motion * (phase === 'reveal' ? Math.sin(elapsed * 12) * Math.exp(-elapsed * 3) * (toy.family === 'star' ? .13 : .07) : 0);
        if (phase === 'reveal') { const t = elapsed / PHASES.reveal, slot = collectionSlot(toy.id); this.deliveryTray.visible = t < .97; this.deliveryTray.position.set(mix(slot.x, -1.08, ease((t - .45) / .55)), mix(slot.y, .50, ease((t - .22) / .60)), mix(slot.z, 1.69, ease(t / .30))); }
      }
      body.scale.set(1 + compression * .65, 1 - compression, 1 + compression * .45); body.rotation.z = wobble;
      const seed = ASSORTMENT.findIndex(t => t.id === toy.id);
      // Attract mode: on the empty machine each toy takes an occasional turn to
      // wave — ears wiggle, the candy star ripples — inviting a passer-by to play.
      let attract = 0;
      if (motion && phase === 'idle' && index < 0) { const beat = (time + seed * 2.83) % 11; if (beat < 1.1) attract = Math.sin(beat / 1.1 * Math.PI); }
      if (blink) { const tick = (time + seed * 1.317) % (4.1 + seed * .23); blink.scale.y = motion && tick < .13 ? .15 + Math.abs(tick - .065) / .065 * .85 : 1; }
      if (motion && blink && held && phase === 'reveal' && elapsed > .32 && elapsed < .52) blink.scale.y = .13;
      for (const ear of articulation) { ear.object.rotation.copy(ear.rest); const lag = motion * (held && ['lift', 'transfer'].includes(phase) ? Math.sin(elapsed * 6 + ear.side) * .14 * Math.exp(-elapsed * 1.2) : wobble * 2) + attract * Math.sin(time * 9 + ear.side) * .15; ear.object.rotation.x += lag; ear.object.rotation.z += wobble; }
      if (motion && plan && !affected && phase === 'lift' && Math.hypot(toy.x - plan.position.x, toy.z - plan.position.z) < .85 && !toy.claimed) body.rotation.z = Math.sin(elapsed * 4) * .026 * Math.exp(-elapsed * 1.7);
      if (motion && aligned?.id === toy.id && phase === 'aim') body.rotation.x = -.035;
      if (wave) { wave.value = motion * (Math.abs(wobble) * .32 + compression * .18 + attract * .09); waveTime.value = time; const drift = Math.sin(.4 * 11 - time * 13) * wave.value * .7; face.position.x = drift; blink.position.x = drift; }
    }
    for (const toy of game.toys) if (toy.impact && !toy.claimed && game.plan?.prize?.id !== toy.id) this.contacts.rock(game, toy, this.toys.get(toy.id), dt);
    this.contacts.resolve(game, pose);
    this.updateClawFeedback(pose, phase, dt, feedback, holding);
    if (phase !== this.lastPhase) {
      const star = plan?.prize?.family === 'star';
      if (phase === 'grip') this.kick(.022, time);
      if (phase === 'lift' && plan?.prize) { this.kick(star ? .06 : .035, time); if (motion) this.spawnBurst(v(pose.x, pose.y - .45, pose.z), star); }
      if (phase === 'reveal' && plan?.prize) { const slot = collectionSlot(plan.prize.id); this.kick(.02, time); if (motion) this.spawnBurst(v(slot.x, slot.y + .35, slot.z + .2), star); }
      this.lastPhase = phase;
    }
    // A reduced-motion toggle mid-flight ends the burst on the same frame,
    // matching every other effect's per-frame motion read.
    if (!motion && this.burst.visible) { this.burst.visible = false; this.burst.count = 0; this.burstParticles = []; }
    else if (this.burst.visible) this.updateBurst(dt);
    this.updateMarquee(phase, plan, time, motion, Boolean(presentation.attract));
    this.courier.visible = this.deliveryTray.visible;
    if (this.courier.visible) { const p = this.deliveryTray.position; this.courier.scale.set(this.deliveryTray.scale.x, 1, this.deliveryTray.scale.z); this.courier.position.set(p.x, 0, 1.69); this.courierMast.scale.y = Math.max(.1, p.y - .44); this.courierMast.position.y = .44 + (p.y - .44) / 2; this.courierArm.scale.y = Math.max(.025, 1.69 - p.z); this.courierArm.position.set(0, p.y - .08, -(1.69 - p.z) / 2); }
    this.updateCamera(game, presentation, time);
    this.draw(time, cameraActive);
  }

  // Attract eases in and out over ~0.4 s; reduced motion cuts.
  updateAttract(active, dt, phase = 'idle') {
    const target = active ? 1 : 0;
    // Attract belongs to idle only: once a turn starts the aiming viewpoint must be exact at once.
    if (phase !== 'idle') { this.attractBlend = 0; return; }
    this.attractBlend = this.reducedMotion || dt <= 0 ? target : this.attractBlend + (target - this.attractBlend) * Math.min(1, dt * 7);
    if (Math.abs(this.attractBlend - target) < .002) this.attractBlend = target;
  }
  // The unattended machine: close framing with a slow drift, so a passer-by sees toys, not a still photograph.
  attractPose(time, position, look) {
    position.copy(this.playCamera);
    if (!this.reducedMotion) { position.x += Math.sin(time * .21) * .9; position.y += Math.sin(time * .13) * .25 + .15; position.z += Math.cos(time * .17) * .4; }
    look.copy(this.playLook); look.y -= .15;
  }
  updateCamera(game, { preparing = false, nextTurnElapsed = 0, machineControls = false, attract = false, dt = 0 } = {}, time = 0) {
    this.updateAttract(attract, dt, game.phase);
    // Stay on the contact through the entire lift. A held prize pulls the view
    // back for its shelf run; after a miss the claw stays put and so does the view.
    let wide = ['idle', 'release', 'deliver', 'reveal', 'result'].includes(game.phase) ? 1 : 0;
    if (game.phase === 'transfer') wide = this.reducedMotion ? 1 : ease(game.elapsed / .65);
    if (game.phase === 'result' && preparing) {
      wide = !game.plan?.prize ? 0 : this.reducedMotion ? Number(nextTurnElapsed < 2.2) : 1 - ease((nextTurnElapsed - 1.6) / .6);
    }
    this.surroundings.visible = wide > 0;
    for (const id of game.collection || []) {
      const object = this.toys.get(id);
      if (object) object.visible = wide > 0 && game.toys.some(toy => toy.id === id);
    }
    this.camera.position.copy(this.playCamera);
    if (machineControls) this.camera.position.z += .65;
    this.camera.position.lerp(this.home, wide);
    this.currentLook.copy(this.playLook);
    if (machineControls) this.currentLook.y -= .20;
    this.currentLook.lerp(this.look, wide);
    if (this.attractBlend > 0) {
      const pose = this.attractScratch ??= { position: new T.Vector3(), look: new T.Vector3() };
      this.attractPose(time, pose.position, pose.look);
      this.camera.position.lerp(pose.position, this.attractBlend);
      this.currentLook.lerp(pose.look, this.attractBlend);
      this.surroundings.visible = this.surroundings.visible || this.attractBlend < 1;
    }
    this.camera.lookAt(this.currentLook);
    const punch = this.punchOffset(time);
    if (punch) { this.camera.position.y += punch; this.camera.position.x += punch * .4; }
  }

  draw(time, cameraActive) {
    // Leave GPU time for camera recognition, especially on 120/144 Hz displays.
    // Only draw submission is capped; transforms and contact response still update.
    const frame = Math.floor((time + .000001) * 30);
    if (cameraActive && frame === this.cameraRenderFrame) return;
    this.cameraRenderFrame = cameraActive ? frame : undefined;
    this.renderer.render(this.scene, this.camera);
  }

  inspect(toyId, phase = 'grip') {
    const toy = this.toys.get(toyId); if (!toy) return;
    const center = toy.position.clone().add(v(0, .5, 0));
    this.camera.position.copy(center).add(v(1.45, 1.0, 2.6)); this.camera.lookAt(center); this.renderer.render(this.scene, this.camera);
  }
}
