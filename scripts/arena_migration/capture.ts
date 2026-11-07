/** One-time conversion tooling. Never imported by the application. */
import * as T from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { ArenaScene } from "../../frontend/src/features/arena/scene";
import { defaultPreferences } from "../../frontend/src/features/arena/preferences";
import { buildDepot } from "./legacy_frontend/depot";
import { buildFoundry } from "./legacy_frontend/foundry";
import { buildOutpost } from "./legacy_frontend/outpost";
import { Props } from "./legacy_frontend/foundry/props";
import { Instances } from "./legacy_frontend/outpost/instances";

const builders = {
  depot_07: buildDepot,
  foundry: buildFoundry,
  outpost: buildOutpost,
};
const region = (id: string, x: number, z: number) =>
  id === "foundry"
    ? z > 17
      ? "Warehouse"
      : z < -17
        ? "Yard"
        : Math.abs(x) > 28
          ? "Flanks"
          : "Core"
    : id === "outpost"
      ? z < -20
        ? "Ridge"
        : z > 10
          ? x < 0
            ? "Garage"
            : "Supply"
          : Math.abs(x) < 12
            ? "Command"
            : "Canyon"
      : "Depot";
const caption: Record<string, string> = {
  boundary: "Периметр",
  concrete: "Бетонная стена",
  column: "Колонна",
  beam: "Крановая балка",
  furnace: "Печь",
  machine: "Станок",
  tank: "Резервуар",
  container: "Контейнер",
  warehouse: "Стена склада",
  roof: "Крыша",
  deck: "Платформа",
  step: "Ступень",
  rail: "Ограждение",
  crate: "Ящик",
  cargo: "Груз",
  rack: "Стеллаж",
  transformer: "Трансформатор",
  compressor: "Компрессор",
  cliff: "Скала каньона",
  rock: "Скала",
  plateau: "Плато",
  terrain: "Склон",
  sandbag: "Мешки",
  radar: "Радар",
  bunker: "Укрытие",
  vehicle: "Машина",
  generator: "Генератор",
  interior: "Перегородка",
  desk: "Стол",
  cabinet: "Шкаф",
  canopy: "Навес",
  post: "Опора",
  tower: "Башня",
};

(window as any).captureArena = async (world: any) => {
  const id = world.map.id as keyof typeof builders;
  let owner: number | null = null,
    serial = 0,
    clear = "#9faeb3";
  const scene = new T.Scene(),
    sun = new T.DirectionalLight(0xffe9c7, 3.2);
  sun.position.set(-18, 35, 20);
  Object.assign(sun.shadow.camera, {
    left: -30,
    right: 30,
    top: 26,
    bottom: -26,
    near: 0.5,
    far: 85,
  });
  scene.fog = new T.Fog(0x9faeb3, 45, 130);
  const groups = new Map<
      string,
      {
        root: T.Group;
        position: number[];
        name: string;
        region: string;
        colliders: number[][];
        surface: string;
      }
    >(),
    lights: any[] = [],
    effects: any[] = [];
  const add = scene.add.bind(scene),
    unit = new T.BoxGeometry(1, 1, 1);
  const groupFor = (mesh: T.Object3D) => {
    const key =
      owner === null
        ? "detail-" + String(serial++).padStart(4, "0")
        : "body-" + String(owner).padStart(3, "0");
    let group = groups.get(key);
    if (!group) {
      const box = owner === null ? null : world.boxes[owner],
        p = box
          ? box.slice(0, 3)
          : [mesh.position.x, Math.max(0, mesh.position.y), mesh.position.z];
      const surface = box
        ? (world.surfaces?.[owner!] ?? (owner! < 4 ? "boundary" : "container"))
        : "decoration";
      const root = new T.Group();
      root.name = key;
      group = {
        root,
        position: p,
        name: box
          ? `${caption[surface] ?? surface} ${owner! + 1}`
          : mesh.name ||
            `${mesh instanceof T.Sprite ? "Надпись" : mesh.geometry?.type === "PlaneGeometry" ? "Покрытие" : "Деталь"} ${key.slice(7)}`,
        region: region(id, p[0], p[2]),
        colliders: box ? [[0, 0, 0, ...box.slice(3)]] : [],
        surface,
      };
      groups.set(key, group);
    }
    return group;
  };
  scene.add = ((...items: T.Object3D[]) => {
    for (let mesh of items) {
      if (mesh instanceof T.PointLight) {
        lights.push({
          position: mesh.position.toArray(),
          intensity: mesh.intensity,
          range: mesh.distance,
          color: "#" + mesh.color.getHexString(),
          decay: mesh.decay,
        });
        continue;
      }
      if (mesh instanceof T.Points) {
        effects.push({
          position: [0, 8, 0],
          count: 40,
          color: "#ffbb6b",
          size: 0.09,
          opacity: 0.55,
          height: 4,
          speed: 0.28,
          spread: 0.8,
          baseRadius: 0.5,
          rotationSpeed: 0.12,
        });
        continue;
      }
      const group = groupFor(mesh);
      if (mesh instanceof T.Sprite) {
        const replacement = new T.Mesh(
          new T.PlaneGeometry(1, 1),
          new T.MeshBasicMaterial({
            map: mesh.material.map,
            transparent: true,
            depthWrite: mesh.material.depthWrite,
          }),
        );
        replacement.position.copy(mesh.position);
        replacement.scale.copy(mesh.scale);
        replacement.userData.billboard = true;
        mesh = replacement;
      }
      mesh.position.sub(new T.Vector3(...group.position));
      mesh.userData = {
        ...mesh.userData,
        arenaCastShadow: mesh.castShadow,
        arenaReceiveShadow: mesh.receiveShadow,
      };
      if (mesh instanceof T.Mesh) {
        const m = mesh.material as T.MeshStandardMaterial;
        m.userData = {
          ...m.userData,
          arenaLighting: m.type,
          arenaEmissiveIntensity: m.emissiveIntensity ?? 1,
          arenaFlatShading: m.flatShading ?? false,
          arenaMapColorSpace: m.map?.colorSpace ?? "",
          arenaMapAnisotropy: m.map?.anisotropy ?? 1,
        };
      }
      group.root.add(mesh);
    }
    return scene;
  }) as any;
  const oldAdd = [Props.prototype.add, Instances.prototype.add],
    oldFinish = [Props.prototype.finish, Instances.prototype.finish];
  const geo: Record<string, T.BufferGeometry> = {
    box: unit,
    cylinder: new T.CylinderGeometry(0.5, 0.5, 1, id === "outpost" ? 10 : 12),
    ring: new T.CylinderGeometry(0.5, 0.5, 1, 12, 1, true),
    rock: new T.IcosahedronGeometry(0.5, 0),
  };
  function captureAdd(
    this: any,
    shape: string,
    style: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rotation = 0,
    shadow = false,
  ) {
    const mesh = new T.Mesh(
      geo[shape],
      (this.materials ?? this.palette)[style],
    );
    mesh.name = style + " / " + shape;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.scale.set(w, h, d);
    mesh.castShadow = mesh.receiveShadow = shadow;
    scene.add(mesh);
  }
  Props.prototype.add = captureAdd as any;
  Instances.prototype.add = captureAdd as any;
  Props.prototype.finish = Instances.prototype.finish = () => {};
  const boxes = world.boxes.map((b: number[]) => b.slice());
  boxes.forEach = (callback: any) =>
    Array.prototype.forEach.call(boxes, (b: any, i: number) => {
      owner = i;
      callback(b, i);
      owner = null;
    });
  const fake: any = {
    scene,
    sun,
    renderer: {
      setClearColor: (c: number) => {
        clear = "#" + new T.Color(c).getHexString();
      },
    },
    placard: ArenaScene.prototype.placard,
    label: ArenaScene.prototype.label,
    box(
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
      parent = scene,
    ) {
      const mesh = new T.Mesh(
        unit,
        new T.MeshStandardMaterial({ color, roughness: 0.83 }),
      );
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    },
  };
  try {
    builders[id](fake, { ...world, boxes });
  } finally {
    [Props.prototype.add, Instances.prototype.add] = oldAdd;
    [Props.prototype.finish, Instances.prototype.finish] = oldFinish;
  }
  scene.add = add;
  // Preserve PBR texture edits made after scene.add (Depot's ground texture).
  for (const g of groups.values())
    g.root.traverse((n) => {
      if (n instanceof T.Mesh) {
        const m = n.material as any;
        m.userData = {
          ...m.userData,
          arenaMapColorSpace: m.map?.colorSpace ?? "",
          arenaMapAnisotropy: m.map?.anisotropy ?? 1,
        };
      }
    });
  const root = new T.Group();
  root.name = "Asset library";
  for (const g of groups.values()) root.add(g.root);
  root.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const binary = (await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: false,
  })) as ArrayBuffer;
  const bytes = new Uint8Array(binary);
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return {
    model: btoa(text),
    groups: [...groups].map(([key, g]) => ({
      key,
      position: g.position,
      name: g.name,
      region: g.region,
      colliders: g.colliders,
      surface: g.surface,
    })),
    lights,
    effects,
    environment: {
      background: clear,
      ambientColor: "#e9f4ff",
      ambientGround: "#6f766d",
      ambientIntensity: 2.5,
      sunColor: "#" + sun.color.getHexString(),
      sunPosition: sun.position.toArray(),
      sunIntensity: sun.intensity,
      sunShadow: [
        sun.shadow.camera.left,
        sun.shadow.camera.right,
        sun.shadow.camera.top,
        sun.shadow.camera.bottom,
        sun.shadow.camera.near,
        sun.shadow.camera.far,
      ],
      fogEnabled: true,
      fogNear: (scene.fog as T.Fog).near,
      fogFar: (scene.fog as T.Fog).far,
      ground: false,
      cameraFar: 180,
    },
    meshes: groups.size,
  };
};

(window as any).benchmarkArena = async (world: any, view: any) => {
  document.body.innerHTML =
    '<canvas style="width:1280px;height:720px;display:block"></canvas>';
  document.body.style.margin = "0";
  const start = performance.now(),
    scene = new ArenaScene(document.querySelector("canvas")!, world, {
      ...defaultPreferences(),
      scale: 0.75,
      shadows: true,
    });
  const frames: number[] = [],
    render: number[] = [];
  let last = performance.now();
  await new Promise<void>((resolve) => {
    function tick(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      const begin = performance.now();
      scene.render(
        [],
        view,
        "owner",
        Math.min(0.1, dt),
        (now - start) / 1000,
        true,
      );
      if (now - start > 1500) {
        frames.push(dt * 1000);
        render.push(performance.now() - begin);
      }
      if (now - start < 3500) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
  frames.sort((a, b) => a - b);
  render.sort((a, b) => a - b);
  (window as any).reviewScene = scene;
  return {
    frameMedian: frames[Math.floor(frames.length / 2)],
    frameP95: frames[Math.floor(frames.length * 0.95)],
    renderP95: render[Math.floor(render.length * 0.95)],
    calls: scene.renderer.info.render.calls,
    triangles: scene.renderer.info.render.triangles,
    memory: scene.renderer.info.memory,
    objects: scene.scene.children.length,
  };
};
