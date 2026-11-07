/*
 * Lightweight capacity smoke test for the isolated mock installation.
 * It opens 100 independent authenticated sessions and repeatedly reads one
 * common roulette room. It never sends a bet or touches a working database.
 */
const base = process.env.TEST_URL ?? 'http://127.0.0.1:8080';
const clients = Number(process.env.CASINO_CLIENTS ?? 100);
const rounds = Number(process.env.CASINO_ROUNDS ?? 10);
const target = new URL(base);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '8080') {
  throw new Error('This scenario is restricted to the GameHub test installation on localhost:8080.');
}
if (
  !Number.isInteger(clients) ||
  clients < 1 ||
  clients > 100 ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 100
) {
  throw new Error('Use 1–100 clients and 1–100 rounds.');
}

function cookie(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const value = values.find((header) => header.startsWith('gh_session='));
  return value?.split(';', 1)[0] ?? '';
}

async function signIn(index) {
  const session = await fetch(`${base}/api/auth/session`);
  let storedCookie = cookie(session);
  const { csrf } = await session.json();
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie: storedCookie },
    body: JSON.stringify({ login: `casino-load-${index}-${Date.now()}` }),
  });
  if (!login.ok) throw new Error(`login ${login.status}`);
  storedCookie = cookie(login) || storedCookie;
  return storedCookie;
}

const sessions = await Promise.all(Array.from({ length: clients }, (_, index) => signIn(index)));
const timings = [];
let failures = 0;
for (let turn = 0; turn < rounds; turn += 1) {
  await Promise.all(
    sessions.map(async (storedCookie) => {
      const started = performance.now();
      const response = await fetch(`${base}/api/casino/rooms/roulette`, {
        headers: { cookie: storedCookie },
      });
      if (!response.ok) {
        failures += 1;
        return;
      }
      const body = await response.json();
      if (!body.round?.id) failures += 1;
      timings.push(performance.now() - started);
    }),
  );
}
timings.sort((a, b) => a - b);
const percentile = (part) =>
  timings[Math.min(timings.length - 1, Math.floor(timings.length * part))];
console.log(
  JSON.stringify({
    clients,
    requests: timings.length,
    failures,
    median_ms: percentile(0.5),
    p95_ms: percentile(0.95),
  }),
);
if (failures) process.exitCode = 1;
