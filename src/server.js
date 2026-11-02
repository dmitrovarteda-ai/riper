import { mkdirSync } from 'node:fs';
import { createCore } from './core.js';
import { createApp } from './app.js';
import { createStripe } from './stripe.js';

const env = process.env;
const secretKey = env.STRIPE_SECRET_KEY ?? '';
const devPayments = env.DEV_PAYMENTS === '1';

// A public server must never run with free test payments or without an admin password.
if (env.NODE_ENV === 'production') {
  const problems = [];
  if (devPayments) problems.push('DEV_PAYMENTS must be 0');
  if ((env.ADMIN_TOKEN ?? '').length < 32) problems.push('ADMIN_TOKEN must be at least 32 characters');
  if (!(env.PUBLIC_URL ?? '').startsWith('https://')) problems.push('PUBLIC_URL must start with https://');
  if (problems.length) {
    console.error(`Refusing to start in production: ${problems.join('; ')}.`);
    process.exit(1);
  }
}

if (devPayments && secretKey.startsWith('sk_live')) {
  console.error('Refusing to start: DEV_PAYMENTS=1 together with a live Stripe key would give items away for free.');
  process.exit(1);
}

mkdirSync('data', { recursive: true });
const boostyMode = env.PAYMENT_MODE === 'boosty';
const boostyLink = (key) => env[`BOOSTY_URL_${key}`] || env.BOOSTY_URL || null;
const boostyUrls = boostyMode ? {
  tier_1: boostyLink('TIER_1'),
  tier_2: boostyLink('TIER_2'),
  tier_3: boostyLink('TIER_3'),
  tier_4: boostyLink('TIER_4'),
  tier_5: boostyLink('TIER_5'),
} : null;

// A person confirms Boosty payments, so the plot has to wait longer than an automatic checkout.
const core = createCore({ dbPath: env.DB_PATH || 'data/riper.db', ...(boostyMode ? { reserveMs: 24 * 3600 * 1000 } : {}) });

const port = Number(env.PORT ?? 3000);
const server = createApp(core, {
  adminToken: env.ADMIN_TOKEN ?? '',
  stripe: secretKey && !boostyMode ? createStripe(secretKey) : null,
  boostyUrls,
  donateUrl: env.DONATE_URL || env.BOOSTY_URL || null,
  cryptsOpen: env.CRYPTS_OPEN === '1',
  ordersOpen: env.ORDERS_OPEN !== '0',
  liveEvents: env.LIVE_EVENTS !== '0',
  adminLocalOnly: env.ADMIN_LOCAL_ONLY === '1',
  webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  devPayments,
  trustProxy: env.TRUST_PROXY === '1',
});

server.listen(port, env.HOST || undefined, () => {
  console.log(`Riper: http://localhost:${port}`);
  if (devPayments) console.log('DEV_PAYMENTS is on: test payments are free. Do not use on a public server.');
  if (!env.ADMIN_TOKEN) console.log('ADMIN_TOKEN is empty: /admin is locked.');
  if (boostyMode) {
    console.log('Payments: Boosty, confirmed by hand in /admin.');
  } else {
    if (!secretKey) console.log('STRIPE_SECRET_KEY is empty: card payments are off.');
    if (!env.STRIPE_WEBHOOK_SECRET) console.log('STRIPE_WEBHOOK_SECRET is empty: the Stripe webhook is off.');
  }
});
