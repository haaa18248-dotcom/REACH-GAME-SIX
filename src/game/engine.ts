import * as THREE from 'three';

export type Theme = 'city' | 'desert' | 'forest';

export interface GameCallbacks {
  onScore: (score: number) => void;
  onCoins: (coins: number) => void;
  onSpeed: (kmh: number) => void;
  onGameOver: (finalScore: number, coins: number) => void;
}

const LANES = [-3.4, 0, 3.4];
const ROAD_W = 11;
const SPAWN_Z = -220;
const KILL_Z = 18;

interface ThemeConf {
  sky: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  sunColor: number;
  sunIntensity: number;
  hemi: number;
}

const THEMES: Record<Theme, ThemeConf> = {
  city: {
    sky: 0x0d1033,
    fogColor: 0x171a45,
    fogNear: 40,
    fogFar: 210,
    ground: 0x14162e,
    sunColor: 0x8899ff,
    sunIntensity: 1.1,
    hemi: 0x3344aa,
  },
  desert: {
    sky: 0xffc98a,
    fogColor: 0xf3b878,
    fogNear: 50,
    fogFar: 230,
    ground: 0xdfab5f,
    sunColor: 0xffe3b0,
    sunIntensity: 1.6,
    hemi: 0xffd9a0,
  },
  forest: {
    sky: 0xa9d7b7,
    fogColor: 0x9ccaa8,
    fogNear: 35,
    fogFar: 190,
    ground: 0x2e6b3a,
    sunColor: 0xfff6d8,
    sunIntensity: 1.4,
    hemi: 0xcfe8cf,
  },
};

interface Entity {
  mesh: THREE.Object3D;
  kind: 'coin' | 'obstacle' | 'traffic';
  lane: number;
  alive: boolean;
  spin?: boolean;
  speedBonus?: number;
}

export class CarGame {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private car!: THREE.Group;
  private wheels: THREE.Mesh[] = [];
  private theme: Theme;
  private cb: GameCallbacks;

  private running = false;
  private destroyed = false;
  private raf = 0;
  private clock = new THREE.Clock();

  // gameplay state
  private laneIndex = 1;
  private carX = 0;
  private carY = 0;
  private velY = 0;
  private flying = false;
  private speed = 28; // units / sec
  private score = 0;
  private coins = 0;
  private distAcc = 0;
  private spawnTimer = 0;
  private dashes: THREE.Mesh[] = [];
  private scenery: { mesh: THREE.Object3D; span: number }[] = [];
  private entities: Entity[] = [];
  private coinGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.18, 20);
  private coinMat = new THREE.MeshStandardMaterial({
    color: 0xffc83d,
    metalness: 0.7,
    roughness: 0.25,
    emissive: 0x6b4a00,
  });

  private keyDown = (e: KeyboardEvent) => this.onKey(e, true);
  private keyUp = (e: KeyboardEvent) => this.onKey(e, false);
  private ptrDown = () => (this.flying = true);
  private ptrUp = () => (this.flying = false);
  private onResize = () => this.resize();

  constructor(private container: HTMLElement, theme: Theme, callbacks: GameCallbacks) {
    this.theme = theme;
    this.cb = callbacks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
    this.camera.position.set(0, 5.2, 11);
    this.camera.lookAt(0, 1.2, -10);

    this.buildWorld();
    this.buildCar();
    this.resize();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    this.renderer.domElement.addEventListener('pointerdown', this.ptrDown);
    window.addEventListener('pointerup', this.ptrUp);
  }

  /* ---------------- world ---------------- */

  private buildWorld() {
    const t = THEMES[this.theme];
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fogColor, t.fogNear, t.fogFar);

    const hemi = new THREE.HemisphereLight(t.hemi, 0x202020, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(t.sunColor, t.sunIntensity);
    sun.position.set(14, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 120;
    this.scene.add(sun);

    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: t.ground, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // road
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, 520),
      new THREE.MeshStandardMaterial({ color: 0x2b2b31, roughness: 0.95 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -200);
    road.receiveShadow = true;
    this.scene.add(road);

    // road edges
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd });
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 520), edgeMat);
      edge.position.set(sx * (ROAD_W / 2 - 0.2), 0.03, -200);
      this.scene.add(edge);
    }

    // lane dashes
    const dashGeo = new THREE.BoxGeometry(0.22, 0.04, 3);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
    for (const lx of [-1.7, 1.7]) {
      for (let i = 0; i < 40; i++) {
        const d = new THREE.Mesh(dashGeo, dashMat);
        d.position.set(lx, 0.02, 10 - i * 8);
        this.scene.add(d);
        this.dashes.push(d);
      }
    }

    this.buildScenery();
  }

  private addScenery(mesh: THREE.Object3D, z: number, span: number) {
    mesh.position.z = z;
    this.scene.add(mesh);
    this.scenery.push({ mesh, span });
  }

  private buildScenery() {
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const span = 300;

    if (this.theme === 'city') {
      const winMat = new THREE.MeshStandardMaterial({
        color: 0x11132a,
        emissive: 0x3d6bff,
        emissiveIntensity: 0.55,
        roughness: 0.4,
      });
      const bodyColors = [0x1c2140, 0x242a52, 0x161a36, 0x2b3166];
      for (let i = 0; i < 46; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const g = new THREE.Group();
        const h = rand(8, 34);
        const w = rand(4, 9);
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, rand(4, 9)),
          new THREE.MeshStandardMaterial({
            color: bodyColors[i % bodyColors.length],
            roughness: 0.8,
          }),
        );
        body.position.y = h / 2;
        g.add(body);
        // glowing window strips
        for (let s = 0; s < 3; s++) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h * 0.86, 0.1), winMat);
          strip.position.set(0, h / 2, (s - 1) * 0.1);
          if (s === 0) strip.position.z = body.geometry.parameters.depth / 2 + 0.06;
          else if (s === 1) {
            strip.rotation.y = Math.PI / 2;
            strip.position.x = w / 2 + 0.06;
            strip.scale.x = body.geometry.parameters.depth / w * 0.82;
          } else {
            strip.rotation.y = -Math.PI / 2;
            strip.position.x = -w / 2 - 0.06;
            strip.scale.x = body.geometry.parameters.depth / w * 0.82;
          }
          g.add(strip);
        }
        g.position.x = side * rand(10, 30);
        this.addScenery(g, -rand(0, span), span);
      }
      // street lights
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x888899 });
      for (let i = 0; i < 16; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.4), poleMat);
        pole.position.y = 2.7;
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.28),
          new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
        );
        lamp.position.set(side * -0.9, 5.3, 0);
        g.add(pole, lamp);
        g.position.x = side * (ROAD_W / 2 + 0.8);
        this.addScenery(g, -i * 20, span + 20);
      }
    } else if (this.theme === 'desert') {
      const cactusMat = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 0.9 });
      for (let i = 0; i < 34; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const g = new THREE.Group();
        const h = rand(1.6, 3.4);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, h, 8), cactusMat);
        trunk.position.y = h / 2;
        trunk.castShadow = true;
        g.add(trunk);
        for (const ax of [-1, 1]) {
          if (Math.random() < 0.75) {
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, h * 0.5, 8), cactusMat);
            arm.position.set(ax * 0.65, h * 0.62, 0);
            arm.rotation.z = ax * -0.35;
            g.add(arm);
          }
        }
        g.position.x = side * rand(8, 34);
        this.addScenery(g, -rand(0, span), span);
      }
      // dunes + rocks
      for (let i = 0; i < 20; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const dune = new THREE.Mesh(
          new THREE.SphereGeometry(rand(4, 12), 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xe8b86d, roughness: 1 }),
        );
        dune.scale.y = 0.32;
        dune.position.x = side * rand(16, 50);
        this.addScenery(dune, -rand(0, span), span);
      }
      for (let i = 0; i < 14; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(rand(0.5, 1.4)),
          new THREE.MeshStandardMaterial({ color: 0xa8825a, roughness: 1 }),
        );
        rock.position.x = side * rand(7, 20);
        rock.castShadow = true;
        this.addScenery(rock, -rand(0, span), span);
      }
    } else {
      // forest pines
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2d, roughness: 1 });
      const leafMats = [0x1c6b32, 0x15592a, 0x247a3c].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }),
      );
      for (let i = 0; i < 60; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const g = new THREE.Group();
        const h = rand(4, 10);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, h * 0.35, 7), trunkMat);
        trunk.position.y = h * 0.17;
        g.add(trunk);
        const mat = leafMats[i % leafMats.length];
        for (let L = 0; L < 3; L++) {
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(h * (0.34 - L * 0.08), h * 0.42, 8),
            mat,
          );
          cone.position.y = h * (0.38 + L * 0.24);
          cone.castShadow = true;
          g.add(cone);
        }
        g.position.x = side * rand(7.5, 36);
        this.addScenery(g, -rand(0, span), span);
      }
      // bushes
      for (let i = 0; i < 18; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const bush = new THREE.Mesh(
          new THREE.SphereGeometry(rand(0.5, 1.1), 8, 6),
          new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 1 }),
        );
        bush.position.x = side * rand(6.5, 18);
        bush.scale.y = 0.7;
        this.addScenery(bush, -rand(0, span), span);
      }
    }
  }

  /* ---------------- car ---------------- */

  private buildCar(colorBody = 0xe0312f) {
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: colorBody,
      metalness: 0.45,
      roughness: 0.3,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fd7ff,
      metalness: 0.2,
      roughness: 0.08,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4.1), bodyMat);
    body.position.y = 0.62;
    body.castShadow = true;
    car.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.56, 2), bodyMat);
    cabin.position.set(0, 1.18, 0.15);
    cabin.castShadow = true;
    car.add(cabin);

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 0.08), glassMat);
    windshield.position.set(0, 1.18, -0.82);
    windshield.rotation.x = -0.32;
    car.add(windshield);

    const rear = windshield.clone();
    rear.position.z = 1.12;
    rear.rotation.x = 0.32;
    car.add(rear);

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.5), darkMat);
    spoiler.position.set(0, 1.1, 1.95);
    car.add(spoiler);
    for (const sx of [-0.7, 0.7]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.4), darkMat);
      fin.position.set(sx, 0.95, 1.95);
      car.add(fin);
    }

    // headlights / taillights
    const hl = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
    const tl = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
    for (const sx of [-0.65, 0.65]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.08), hl);
      h.position.set(sx, 0.68, -2.06);
      car.add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.08), tl);
      t.position.set(sx, 0.68, 2.06);
      car.add(t);
    }

    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.38, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.8, roughness: 0.3 });
    for (const [x, z] of [
      [-1.02, -1.35],
      [1.02, -1.35],
      [-1.02, 1.35],
      [1.02, 1.35],
    ]) {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.position.set(x, 0.42, z);
      w.castShadow = true;
      w.add(new THREE.Mesh(hubGeo, hubMat));
      car.add(w);
      this.wheels.push(w);
    }

    car.position.set(0, 0, 4);
    this.scene.add(car);
    this.car = car;
  }

  /* ---------------- spawning ---------------- */

  private makeObstacle(): THREE.Object3D {
    // striped barrier
    const g = new THREE.Group();
    const or = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.8 });
    const wh = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.5), i % 2 ? wh : or);
      seg.position.set(-0.93 + i * 0.62, 0.95, 0);
      seg.castShadow = true;
      g.add(seg);
    }
    const legMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    for (const sx of [-1.05, 1.05]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.14), legMat);
      leg.position.set(sx, 0.37, 0);
      g.add(leg);
    }
    return g;
  }

  private makeTrafficCar(): THREE.Object3D {
    const colors = [0x2f6fe0, 0x29a35a, 0xaaaaaa, 0xe0a62f, 0x8844cc];
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: colors[(Math.random() * colors.length) | 0],
      metalness: 0.4,
      roughness: 0.4,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 3.6), mat);
    body.position.y = 0.6;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.7), mat);
    cabin.position.y = 1.12;
    const tl = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.15, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xff2f2f }),
    );
    tl.position.set(0, 0.66, 1.83);
    g.add(body, cabin, tl);
    const wGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
    wGeo.rotateZ(Math.PI / 2);
    const wMat = new THREE.MeshStandardMaterial({ color: 0x151515 });
    for (const [x, z] of [[-0.95, -1.2], [0.95, -1.2], [-0.95, 1.2], [0.95, 1.2]]) {
      const w = new THREE.Mesh(wGeo, wMat);
      w.position.set(x, 0.38, z);
      g.add(w);
    }
    return g;
  }

  private spawnWave() {
    const r = Math.random();
    const lane = (Math.random() * 3) | 0;
    if (r < 0.42) {
      // line of coins — sometimes raised so you must FLY to get them
      const high = Math.random() < 0.45;
      const n = 4 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const c = new THREE.Mesh(this.coinGeo, this.coinMat);
        c.rotation.z = Math.PI / 2;
        const y = high ? 3.2 + Math.sin((i / (n - 1)) * Math.PI) * 1.6 : 1.3;
        c.position.set(LANES[lane], y, SPAWN_Z - i * 4.5);
        this.scene.add(c);
        this.entities.push({ mesh: c, kind: 'coin', lane, alive: true, spin: true });
      }
    } else if (r < 0.72) {
      const o = this.makeObstacle();
      o.position.set(LANES[lane], 0, SPAWN_Z);
      this.scene.add(o);
      this.entities.push({ mesh: o, kind: 'obstacle', lane, alive: true });
      // sometimes block a 2nd lane too
      if (Math.random() < 0.35) {
        const lane2 = (lane + 1 + ((Math.random() * 2) | 0)) % 3;
        const o2 = this.makeObstacle();
        o2.position.set(LANES[lane2], 0, SPAWN_Z - 2);
        this.scene.add(o2);
        this.entities.push({ mesh: o2, kind: 'obstacle', lane: lane2, alive: true });
      }
    } else {
      const t = this.makeTrafficCar();
      t.position.set(LANES[lane], 0, SPAWN_Z);
      this.scene.add(t);
      this.entities.push({
        mesh: t,
        kind: 'traffic',
        lane,
        alive: true,
        speedBonus: 10 + Math.random() * 6, // slower than player => approaches
      });
    }
  }

  /* ---------------- input ---------------- */

  private onKey(e: KeyboardEvent, down: boolean) {
    if (['ArrowUp', ' ', 'Spacebar', 'w', 'W'].includes(e.key)) {
      e.preventDefault();
      this.flying = down;
    }
    if (!down) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      this.laneIndex = Math.max(0, this.laneIndex - 1);
    }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      this.laneIndex = Math.min(2, this.laneIndex + 1);
    }
  }

  public setLaneDelta(d: number) {
    this.laneIndex = Math.max(0, Math.min(2, this.laneIndex + d));
  }
  public setFly(on: boolean) {
    this.flying = on;
  }

  /* ---------------- loop ---------------- */

  start() {
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.running) this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private update(dt: number) {
    // difficulty ramp
    this.speed = Math.min(62, this.speed + dt * 0.55);
    this.cb.onSpeed(Math.round(this.speed * 3.4));

    // distance score
    this.distAcc += this.speed * dt;
    if (this.distAcc >= 4) {
      this.score += Math.floor(this.distAcc / 4);
      this.distAcc %= 4;
      this.cb.onScore(this.score);
    }

    // --- car physics ---
    const targetX = LANES[this.laneIndex];
    this.carX += (targetX - this.carX) * Math.min(1, dt * 9);

    const GRAV = -26;
    const THRUST = 46;
    this.velY += (this.flying ? THRUST : 0) * dt + GRAV * dt;
    this.velY = Math.max(-18, Math.min(11, this.velY));
    this.carY += this.velY * dt;
    if (this.carY <= 0) {
      this.carY = 0;
      this.velY = 0;
    }
    if (this.carY > 7.5) {
      this.carY = 7.5;
      this.velY = Math.min(this.velY, 0);
    }

    this.car.position.x = this.carX;
    this.car.position.y = this.carY;
    this.car.rotation.z = (this.carX - targetX) * 0.06 + Math.sin(performance.now() / 300) * 0.004;
    this.car.rotation.y = (targetX - this.carX) * -0.045;
    this.car.rotation.x = THREE.MathUtils.clamp(-this.velY * 0.035, -0.4, 0.3);

    // wheels spin (slower in air)
    const spin = (this.carY > 0.05 ? 6 : this.speed) * dt * 2.2;
    for (const w of this.wheels) w.rotation.x += spin;

    // camera follows
    this.camera.position.x += (this.carX * 0.5 - this.camera.position.x) * dt * 4;
    this.camera.position.y += (5.2 + this.carY * 0.55 - this.camera.position.y) * dt * 5;
    this.camera.lookAt(this.carX * 0.6, 1.2 + this.carY * 0.6, -12);

    // --- scroll dashes ---
    for (const d of this.dashes) {
      d.position.z += this.speed * dt;
      if (d.position.z > KILL_Z) d.position.z -= 320;
    }
    // --- scroll scenery ---
    for (const s of this.scenery) {
      s.mesh.position.z += this.speed * dt;
      if (s.mesh.position.z > KILL_Z + 20) s.mesh.position.z -= s.span + 40;
    }

    // --- spawn items ---
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
      this.spawnTimer = Math.max(0.55, 1.6 - this.speed * 0.012) * (0.7 + Math.random() * 0.8);
    }

    // --- entities ---
    const carBox = {
      x: this.carX,
      y: this.carY + 0.8,
      z: this.car.position.z,
      hw: 1.0,
      hh: 0.85,
      hd: 2.0,
    };
    for (const e of this.entities) {
      if (!e.alive) continue;
      const vz = this.speed - (e.speedBonus ?? 0);
      e.mesh.position.z += vz * dt;
      if (e.spin) e.mesh.rotation.y += dt * 4;
      if (e.mesh.position.z > KILL_Z) {
        e.alive = false;
        this.scene.remove(e.mesh);
        continue;
      }
      // collision
      const dx = Math.abs(e.mesh.position.x - carBox.x);
      const dz = Math.abs(e.mesh.position.z - carBox.z);
      if (e.kind === 'coin') {
        const dy = Math.abs(e.mesh.position.y - carBox.y);
        if (dx < 1.4 && dz < 1.9 && dy < 1.6) {
          e.alive = false;
          this.scene.remove(e.mesh);
          this.coins++;
          this.score += 10;
          this.cb.onCoins(this.coins);
          this.cb.onScore(this.score);
        }
      } else {
        const obstacleTop = e.kind === 'traffic' ? 1.6 : 1.35;
        if (dx < 1.7 && dz < (e.kind === 'traffic' ? 3.2 : 1.3) && this.carY < obstacleTop) {
          this.crash();
          return;
        }
      }
    }
  }

  private crash() {
    this.running = false;
    // little crash animation
    const start = performance.now();
    const animate = () => {
      if (this.destroyed) return;
      const t = (performance.now() - start) / 600;
      if (t < 1) {
        this.car.rotation.z = Math.sin(t * 14) * 0.3 * (1 - t);
        this.car.position.y = Math.abs(Math.sin(t * 10)) * 0.8 * (1 - t);
        requestAnimationFrame(animate);
        this.renderer.render(this.scene, this.camera);
      }
    };
    animate();
    this.cb.onGameOver(this.score, this.coins);
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('pointerup', this.ptrUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.ptrDown);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
