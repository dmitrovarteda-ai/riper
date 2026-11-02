// Simulates viewers on a real HTTP server with an in-memory database:
// each viewer holds an event stream and refreshes state; some buy and care.
import { createCore } from '../src/core.js';
import { createApp } from '../src/app.js';

const VIEWERS = Number(process.argv[2] ?? 100);
const SECONDS = Number(process.argv[3] ?? 20);
const BUYERS = 40;

const core = createCore();
const server = createApp(core, { devPayments: true, trustProxy: true });
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const timings = [];
const errors = {};
let received = 0;

async function hit(path, ip, body) {
  const started = performance.now();
  try {
    const res = await fetch(base + path, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify(body),
    } : { headers: { 'X-Forwarded-For': ip } });
    const data = await res.json();
    timings.push(performance.now() - started);
    if (!res.ok) errors[data.error ?? res.status] = (errors[data.error ?? res.status] ?? 0) + 1;
    return data;
  } catch (err) {
    errors[err.code ?? err.message] = (errors[err.code ?? err.message] ?? 0) + 1;
    return {};
  }
}

const stopAt = Date.now() + SECONDS * 1000;
const controllers = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function viewer(index) {
  const ip = `10.0.0.${index}`;
  const controller = new AbortController();
  controllers.push(controller);
  fetch(`${base}/api/events`, { signal: controller.signal }).then(async (res) => {
    for await (const chunk of res.body) received += chunk.length;
  }).catch(() => {});
  await sleep(Math.random() * 2000);
  while (Date.now() < stopAt) {
    await hit('/api/state', ip);
    await sleep(1000 + Math.random() * 2000);
  }
}

async function buyer(index) {
  const ip = `10.0.1.${index}`;
  await sleep(Math.random() * 3000);
  const order = await hit('/api/orders/grave', ip, { plot: index, name: `Load ${index}`, consent: true });
  if (!order.token) return;
  await hit(`/api/orders/${order.token}/dev-pay`, ip, {});
  const { code } = await hit(`/api/orders/${order.token}`, ip);
  core.admin.review(index, 'approved');
  while (Date.now() < stopAt) {
    await sleep(5000 + Math.random() * 5000);
    if (Date.now() < stopAt) await hit('/api/grave/care', ip, { code, action: 'clean' });
  }
}

const jobs = [];
for (let i = 0; i < VIEWERS; i++) jobs.push(viewer(i));
const freePlots = core.state().plots.filter((plot) => !plot.ad).map((plot) => plot.plot);
for (let i = 0; i < BUYERS; i++) jobs.push(buyer(freePlots[i]));
await Promise.all(jobs);

for (const controller of controllers) controller.abort();
server.closeClients();
server.closeAllConnections();
await new Promise((resolve) => server.close(resolve));

timings.sort((a, b) => a - b);
const pct = (p) => timings[Math.floor(timings.length * p)]?.toFixed(1);
console.log(JSON.stringify({
  viewers: VIEWERS,
  seconds: SECONDS,
  requests: timings.length,
  p50ms: pct(0.5),
  p95ms: pct(0.95),
  maxMs: timings.at(-1)?.toFixed(1),
  graves: core.state().plots.filter((plot) => plot.grave).length,
  sseBytes: received,
  errors,
}));
process.exit(0);
