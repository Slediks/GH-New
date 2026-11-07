// Read-only delivery measurement on the isolated mock installation. No wagers.
import { io } from 'socket.io-client';
import { writeFile } from 'node:fs/promises';

const target = new URL(process.env.TEST_URL ?? 'http://127.0.0.1:8080');
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '8080') {
  throw new Error('Use only the GameHub test installation on localhost:8080.');
}
const base = target.origin,
  count = 100,
  seconds = 30;
const rooms = ['roulette', 'crash', 'wheel-low', 'wheel-medium', 'wheel-high', 'horses'];
const sockets = [],
  received = Array(count).fill(0),
  timings = [],
  errors = [],
  frames = new Map();
let measuring = false,
  closing = false;
const started = Date.now();

async function connect(index) {
  let cookie = '';
  async function request(path, init = {}) {
    const response = await fetch(base + path, {
      ...init,
      headers: { Cookie: cookie, Origin: base, ...init.headers },
    });
    for (const header of response.headers.getSetCookie()) {
      if (header.startsWith('gh_session=')) cookie = header.split(';', 1)[0];
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  const session = await request('/api/auth/session');
  await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    body: JSON.stringify({ login: `casino-rt-${started}-${index}` }),
  });
  const room = rooms[index % rooms.length];
  const socket = io(base, {
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    extraHeaders: { Cookie: cookie, Origin: base },
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`No first frame for client ${index}`)),
      20000,
    );
    socket.on('connect_error', reject);
    socket.on('connect', () =>
      socket.emit('casino:watch', { room }, (reply) => {
        if (!reply?.ok) reject(new Error('Subscription rejected'));
      }),
    );
    socket.on('disconnect', (reason) => {
      if (!closing) errors.push(`Disconnect ${index}: ${reason}`);
    });
    socket.on('casino:room', (frame) => {
      clearTimeout(timeout);
      resolve();
      if (!measuring) return;
      if (frame.room !== room || 'mine' in frame.round.state || 'chips' in frame.round.state)
        errors.push(`Private or wrong-room frame ${index}`);
      const key = `${room}:${frame.round.id}:${frame.round.state.server_time}`,
        encoded = JSON.stringify(frame);
      if (frames.has(key) && frames.get(key) !== encoded) errors.push('Inconsistent shared frame');
      frames.set(key, encoded);
      received[index]++;
      timings.push(Date.now() - frame.round.state.server_time * 1000);
    });
    socket.connect();
  });
}

try {
  for (let start = 0; start < count; start += 10)
    await Promise.all(Array.from({ length: 10 }, (_, offset) => connect(start + offset)));
  console.log('100 authenticated subscriptions ready; measuring 30 seconds.');
  measuring = true;
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  measuring = false;
} catch (error) {
  errors.push(error.message);
}
const connected = sockets.filter((socket) => socket.connected).length;
closing = true;
sockets.forEach((socket) => socket.disconnect());
timings.sort((a, b) => a - b);
const percentile = (q) =>
  timings.length ? Math.round(timings[Math.floor((timings.length - 1) * q)] * 100) / 100 : null;
const result = {
  measured_at: new Date().toISOString(),
  requested_clients: count,
  connected_clients: connected,
  duration_seconds: seconds,
  rooms,
  received_frames: received.reduce((sum, value) => sum + value, 0),
  minimum_per_client: Math.min(...received),
  median_delivery_ms: percentile(0.5),
  p95_delivery_ms: percentile(0.95),
  inconsistent_frames: errors.filter((value) => value === 'Inconsistent shared frame').length,
  errors,
  environment:
    'Node.js Socket.IO clients, localhost Docker Desktop; not 100 rendered browsers or a Wi-Fi measurement.',
};
await writeFile('../docs/casino-realtime-load.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (errors.length || connected !== count || Math.min(...received) < 1) process.exitCode = 1;
