/** Ten real authenticated Socket.IO clients on the existing 8080; no new server. */
import { createRequire } from "node:module";
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { io } = require("socket.io-client");
const { request } = require("@playwright/test");
// Execute the shipped local collision integrator in load clients, not a second physics model.
const ts = require("typescript");
const source = readFileSync(
  new URL("../frontend/src/features/arena/movement.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { move, initialPhysics } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
let manifest;
const base = "http://127.0.0.1:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];
let room, timer;
const mapId = "outpost";
const count = process.argv.includes("--3v3") ? 6 : 10;
const audioCheck = process.argv.includes("--audio");
const audioEvents = new Map();
let largestSnapshot = 0;
const percentile = (a, p) => {
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor((b.length - 1) * p)] ?? 0;
};
const metrics = () =>
  JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "arena",
        "python",
        "-c",
        "import urllib.request; print(urllib.request.urlopen('http://localhost:5001/metrics').read().decode())",
      ],
      { encoding: "utf8" },
    ),
  );
async function post(c, path, data = {}) {
  const r = await c.api.post(base + "/api" + path, {
    data,
    headers: { "X-CSRF-Token": c.csrf },
  });
  if (!r.ok()) throw new Error(path + ": " + (await r.text()));
  return r.json();
}
async function connect(c) {
  const { ticket } = await post(c, `/arena/rooms/${room.id}/ticket`);
  const socket = (c.socket = io(base, {
    path: "/arena/socket.io",
    transports: ["websocket"],
    auth: { ticket },
    reconnection: false,
  }));
  socket.on("probe", (n) => socket.emit("probe_reply", n));
  socket.on("snapshot", (s) => {
    const now = performance.now();
    if (c.lastAt && now - c.lastAt < 1000) c.intervals.push(now - c.lastAt);
    c.lastAt = now;
    c.state = s;
    c.packets++;
    c.bytes += Buffer.byteLength(JSON.stringify(s));
    largestSnapshot = Math.max(
      largestSnapshot,
      Buffer.byteLength(JSON.stringify(s)),
    );
    for (const e of s.events)
      if (["shot", "reload", "step", "jump", "land", "kill"].includes(e.kind))
        audioEvents.set(e.id, e.kind);
    const me = s.players.find((p) => p.id === c.id);
    if (me) {
      c.seq = Math.max(c.seq, me.seq ?? 0);
      if (me.ping) c.pings.push(me.ping);
      if (!c.local || c.epoch !== me.movement_epoch) {
        c.local = initialPhysics(me);
        c.epoch = me.movement_epoch;
      }
    }
    if (s.phase === "active") c.active = true;
    for (const e of s.events) if (e.kind === "kill") c.kills.add(e.id);
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Connection timeout")),
      10000,
    );
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.emit("loaded");
      resolve();
    });
    socket.once("connect_error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}
try {
  for (let i = 0; i < count; i++) {
    const api = await request.newContext();
    const c = {
      api,
      seq: 0,
      packets: 0,
      bytes: 0,
      intervals: [],
      pings: [],
      kills: new Set(),
      active: false,
    };
    clients.push(c);
    const anon = await (await api.get(base + "/api/auth/session")).json();
    const login = await api.post(base + "/api/auth/login", {
      data: { login: `arena-load-${i + 1}` },
      headers: { "X-CSRF-Token": anon.csrf },
    });
    if (!login.ok()) throw Error(await login.text());
    const session = await (await api.get(base + "/api/auth/session")).json();
    c.id = session.user.id;
    c.csrf = session.csrf;
    const list = await (await api.get(base + "/api/arena/rooms")).json();
    for (const r of list.rooms)
      if (r.players.some((p) => p.id === c.id))
        await post(c, `/arena/rooms/${r.id}/leave`);
  }
  room = await post(clients[0], "/arena/rooms", {
    name: "QA Outpost " + count,
    settings: {
      map_id: mapId,
      mode: "elimination",
      size: count / 2,
      full: true,
      rounds: 9,
      kills: 100,
      minutes: 8,
    },
  });
  for (const c of clients.slice(1))
    await post(c, `/arena/rooms/${room.id}/join`);
  for (const c of clients)
    await post(c, `/arena/rooms/${room.id}/ready`, { ready: true });
  manifest = (await post(clients[0], `/arena/rooms/${room.id}/start`)).manifest;
  await sleep(1300);
  await Promise.all(clients.map(connect));
  for (let n = 0; n < 100 && !clients.every((c) => c.active); n++)
    await sleep(100);
  if (!clients.every((c) => c.active)) throw Error("Not all clients active");
  const before = metrics(),
    start = performance.now();
  // Local simulation reports movement; server alone decides damage and kills.
  timer = setInterval(() => {
    for (const [i, c] of clients.entries()) {
      const s = c.state,
        me = s?.players.find((p) => p.id === c.id);
      if (!me?.alive || !c.local || !c.socket.connected || s.phase !== "active")
        continue;
      const enemy = s.players
        .filter((p) => p.team !== me.team && p.alive)
        .sort(
          (a, b) =>
            Math.hypot(a.x - me.x, a.z - me.z) -
            Math.hypot(b.x - me.x, b.z - me.z),
        )[0];
      let target = enemy ?? { x: 0, y: 0, z: 0 };
      if (mapId === "outpost") {
        if (c.routeDeaths !== me.deaths || !c.route) {
          const side = me.team === "Alpha" ? -1 : 1,
            lane = side < 0 ? -16 : -14;
          c.routeDeaths = me.deaths;
          c.route = [
            [side * 40, 0],
            [side * 40, lane],
            [side * 34, lane],
            [side * 24, lane],
            [side * 14, lane],
          ];
        }
        while (
          c.route.length &&
          Math.hypot(c.route[0][0] - me.x, c.route[0][1] - me.z) < 1.1
        )
          c.route.shift();
        if (c.route.length)
          target = { x: c.route[0][0], y: 0, z: c.route[0][1] };
      }
      const yaw = Math.atan2(target.x - me.x, -(target.z - me.z));
      const pitch = Math.atan2(
        target.y - me.y,
        Math.max(1, Math.hypot(target.x - me.x, target.z - me.z)),
      );
      const seconds = (performance.now() - start) / 1000;
      const input = {
        seq: ++c.seq,
        yaw,
        pitch,
        forward: 1,
        side:
          mapId === "outpost" && c.route?.length
            ? 0
            : Math.sin(seconds + i) > 0.6
              ? 1
              : 0,
        jump: Math.floor(seconds) % 5 === i % 5,
        crouch: Math.floor(seconds) % 7 === i % 7,
        fire: !!enemy,
        fire_id: 1,
        reload: me.ammo?.rifle[0] === 0,
        weapon: "rifle",
      };
      for (let step = 0; step < 4; step++)
        c.local = move(
          c.local,
          input,
          manifest,
          s.players.filter((p) => p.id !== c.id),
          1 / 120,
        );
      input.movement = { ...c.local, epoch: c.epoch };
      c.socket.emit("input", input);
    }
  }, 1000 / 30);
  await sleep(20000);
  clients[0].socket.disconnect();
  await sleep(1000);
  await connect(clients[0]);
  await sleep(40000);
  clearInterval(timer);
  const after = metrics(),
    seconds = (performance.now() - start) / 1000;
  const result = {
    map_id: mapId,
    at: new Date().toISOString(),
    clients: count,
    teams: `${count / 2}v${count / 2}`,
    duration_seconds: seconds,
    reconnect: clients[0].socket.connected,
    audio_events: Object.fromEntries(
      ["shot", "reload", "step", "jump", "land", "kill"].map((k) => [
        k,
        [...audioEvents.values()].filter((v) => v === k).length,
      ]),
    ),
    largest_snapshot_bytes: largestSnapshot,
    server: after,
    cpu_percent_one_core:
      ((after.cpu_seconds - before.cpu_seconds) / seconds) * 100,
    snapshots_per_client_per_second: clients.map((c) => c.packets / seconds),
    snapshot_interval_ms_p95: percentile(
      clients.flatMap((c) => c.intervals),
      0.95,
    ),
    rtt_ms_p95: percentile(
      clients.flatMap((c) => c.pings),
      0.95,
    ),
    outbound_bytes_per_second:
      clients.reduce((n, c) => n + c.bytes, 0) / seconds,
    kills: Math.max(...clients.map((c) => c.kills.size)),
    players: clients[0].state.players.map(({ name, kills, deaths, ping }) => ({
      name,
      kills,
      deaths,
      ping,
    })),
  };
  writeFileSync(
    new URL(`../docs/arena-outpost-network-${count}.json`, import.meta.url),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  if (
    !result.reconnect ||
    result.snapshots_per_client_per_second.some((n) => n < 10)
  )
    process.exitCode = 1;
} finally {
  clearInterval(timer);
  for (const c of clients) {
    c.socket?.disconnect();
    if (room) await post(c, `/arena/rooms/${room.id}/leave`).catch(() => {});
    await c.api.dispose();
  }
}
