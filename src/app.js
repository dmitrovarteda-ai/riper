import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { UserError, PRODUCTS, CURRENCY, CHECKOUT_MS, COLORS, STYLES, ITEMS, ITEM_LIMITS, FENCE_MIN_TIER, EPITAPH_MIN_TIER } from './core.js';
import { verifyWebhook } from './stripe.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const MAX_BODY = 16 * 1024;
const MAX_WEBHOOK_BODY = 256 * 1024;
const MAX_BACKUP_BODY = 2 * 1024 * 1024;
const ROUTES = { '/': 'index.html', '/stream': 'stream.html', '/admin': 'admin.html', '/terms': 'terms.html', '/privacy': 'privacy.html' };
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function loadStatic() {
  const files = new Map();
  for (const name of readdirSync(PUBLIC_DIR)) {
    files.set(name, { body: readFileSync(join(PUBLIC_DIR, name)), type: MIME[extname(name)] ?? 'application/octet-stream' });
  }
  return files;
}

function sameSecret(a, b) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new UserError('too_large', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  try {
    return JSON.parse((await readBody(req, limit)) || '{}') ?? {};
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError('bad_json');
  }
}

function rateLimiter(limit, windowMs, now) {
  const hits = new Map();
  return {
    check(key) {
      const at = now();
      const entry = hits.get(key);
      if (!entry || at > entry.resetAt) {
        hits.set(key, { count: 1, resetAt: at + windowMs });
        return;
      }
      if (++entry.count > limit) throw new UserError('too_many_requests', 429);
    },
    sweep() {
      const at = now();
      for (const [key, entry] of hits) if (at > entry.resetAt) hits.delete(key);
    },
  };
}

export function createApp(core, { adminToken = '', stripe = null, boostyUrls = null, donateUrl = null, cryptsOpen = false, ordersOpen = true, liveEvents = true, adminLocalOnly = false, webhookSecret = '', publicUrl = 'http://localhost:3000', devPayments = false, trustProxy = false, now = Date.now } = {}) {
  const files = loadStatic();
  const clients = new Set();
  const limits = {
    code: rateLimiter(20, 60_000, now),
    order: rateLimiter(10, 60_000, now),
    report: rateLimiter(5, 60_000, now),
  };
  let cachedState = null;
  let cachedAt = 0;

  function broadcast(message) {
    if (message.type === 'changed') cachedState = null;
    const line = `data: ${JSON.stringify(message)}\n\n`;
    for (const res of clients) res.write(line);
  }
  const unsubscribe = core.subscribe(broadcast);
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
    for (const limit of Object.values(limits)) limit.sweep();
  }, 25_000);
  heartbeat.unref();
  const purge = setInterval(() => core.purge(), 3600_000);
  purge.unref();

  function send(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(payload);
  }

  function clientIp(req) {
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    return forwarded || req.socket.remoteAddress || 'unknown';
  }

  function requireAdmin(req) {
    // Anything arriving through the tunnel carries a forwarded header; the owner works locally.
    if (adminLocalOnly && (req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'])) throw new UserError('not_found', 404);
    const header = String(req.headers.authorization ?? '');
    if (!adminToken || !sameSecret(header, `Bearer ${adminToken}`)) throw new UserError('unauthorized', 401);
  }

  function stateJson() {
    // Time-based decay changes slowly, so a short cache protects the database under load.
    if (!cachedState || now() - cachedAt > 1000) {
      cachedState = JSON.stringify(core.state());
      cachedAt = now();
    }
    return cachedState;
  }

  async function withCheckout(order) {
    if (boostyUrls) return { ...order, manual: true, paymentUrl: boostyUrls[order.product] ?? null };
    if (!stripe) return { ...order, checkoutUrl: null };
    const product = PRODUCTS[order.product];
    try {
      const session = await stripe.createCheckout({
        token: order.token,
        productName: product.title,
        amountCents: product.price * 100,
        currency: CURRENCY,
        expiresAt: now() + CHECKOUT_MS,
        publicUrl,
      });
      core.attachCheckout(order.token, session.id);
      return { ...order, checkoutUrl: session.url };
    } catch (err) {
      console.error(err.message);
      core.cancelOrder(order.token);
      throw new UserError('payment_unavailable', 502);
    }
  }

  // With manual confirmation the Boosty name is how the owner finds the payment.
  function requireBuyer(body) {
    if (boostyUrls && !String(body.buyerRef ?? '').trim()) throw new UserError('buyer_required');
    return body;
  }

  function applySession(session) {
    return core.applyCheckout({
      id: session.id,
      token: session.client_reference_id,
      paymentStatus: session.payment_status,
      // Subtotal, because tax may be added on top of our price depending on the buyer's country.
      amountTotal: session.amount_subtotal ?? session.amount_total,
      currency: session.currency,
      email: session.customer_details?.email,
    });
  }

  async function handleApi(req, res, path) {
    const { method } = req;
    const ip = clientIp(req);

    if (method === 'GET' && path === '/api/state') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(stateJson());
      return;
    }
    if (method === 'GET' && path === '/api/config') {
      send(res, 200, { products: core.products(), devPayments, manualPayments: !!boostyUrls, donateUrl, cryptsOpen, ordersOpen, liveEvents, colors: COLORS, styles: STYLES, items: ITEMS, itemLimits: ITEM_LIMITS, fenceTier: FENCE_MIN_TIER, epitaphTier: EPITAPH_MIN_TIER });
      return;
    }
    if (method === 'GET' && path === '/api/events') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (method === 'POST' && path === '/webhooks/stripe') {
      if (!webhookSecret) throw new UserError('webhook_disabled', 503);
      const raw = await readBody(req, MAX_WEBHOOK_BODY);
      if (!verifyWebhook(raw, req.headers['stripe-signature'], webhookSecret, now)) throw new UserError('unauthorized', 401);
      const event = JSON.parse(raw);
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        applySession(event.data.object);
      }
      send(res, 200, { ok: true });
      return;
    }
    if (method === 'POST' && path.startsWith('/api/orders/') && ['grave', 'upgrade', 'crypt'].includes(path.split('/')[3]) && !ordersOpen) {
      throw new UserError('orders_closed', 403);
    }
    if (method === 'POST' && path === '/api/orders/grave') {
      limits.order.check(ip);
      send(res, 201, await withCheckout(core.createGraveOrder(requireBuyer(await readJson(req)))));
      return;
    }
    if (method === 'POST' && path === '/api/orders/crypt') {
      if (!cryptsOpen) throw new UserError('crypts_beta', 403);
      limits.order.check(ip);
      send(res, 201, await withCheckout(core.createCryptOrder(requireBuyer(await readJson(req)))));
      return;
    }
    if (method === 'POST' && path === '/api/orders/upgrade') {
      limits.code.check(ip);
      send(res, 201, await withCheckout(core.createUpgradeOrder(requireBuyer(await readJson(req)))));
      return;
    }
    const orderMatch = path.match(/^\/api\/orders\/([\w-]{20,64})(\/dev-pay|\/sync|\/cancel)?$/);
    if (orderMatch) {
      const [, token, action] = orderMatch;
      if (method === 'GET' && !action) {
        const order = core.order(token);
        send(res, 200, boostyUrls ? { ...order, manual: true, paymentUrl: boostyUrls[order.product] ?? null } : order);
        return;
      }
      if (method === 'POST' && action === '/dev-pay' && devPayments) {
        core.devPay(token);
        send(res, 200, { ok: true });
        return;
      }
      // Asks Stripe directly, so a late or missing webhook doesn't leave the buyer waiting.
      if (method === 'POST' && action === '/sync' && stripe) {
        limits.code.check(ip);
        const { session, status } = core.checkoutOf(token);
        if (session && status === 'pending') applySession(await stripe.retrieveCheckout(session));
        send(res, 200, core.order(token));
        return;
      }
      // The order is freed only once Stripe confirms this checkout can no longer be paid.
      if (method === 'POST' && action === '/cancel') {
        const { session, status } = core.checkoutOf(token);
        if (status === 'pending') {
          if (session && stripe) await stripe.expireCheckout(session);
          core.cancelOrder(token);
        }
        send(res, 200, { ok: true });
        return;
      }
    }
    if (method === 'POST' && path === '/api/grave') {
      limits.code.check(ip);
      send(res, 200, core.grave((await readJson(req)).code));
      return;
    }
    if (method === 'POST' && path === '/api/grave/care') {
      limits.code.check(ip);
      const { code, action } = await readJson(req);
      send(res, 200, core.care(code, action));
      return;
    }
    if (method === 'POST' && path === '/api/grave/customize') {
      limits.code.check(ip);
      const { code, color, style, fence, items, epitaph, link } = await readJson(req);
      send(res, 200, { ok: core.customize(code, { color, style, fence, items, epitaph, link }) });
      return;
    }
    if (method === 'POST' && path === '/api/grave/rename') {
      limits.code.check(ip);
      const { code, name } = await readJson(req);
      send(res, 200, { ok: core.rename(code, name) });
      return;
    }
    if (method === 'POST' && path === '/api/report') {
      limits.report.check(ip);
      const { plot, reason } = await readJson(req);
      send(res, 201, { ok: core.report(plot, reason) });
      return;
    }
    if (path.startsWith('/api/admin/')) {
      requireAdmin(req);
      if (method === 'GET' && path === '/api/admin/queue') {
        send(res, 200, core.admin.queue());
        return;
      }
      if (method === 'GET' && path === '/api/admin/export') {
        send(res, 200, core.admin.exportGraves());
        return;
      }
      if (method === 'POST' && path === '/api/admin/import') {
        send(res, 200, { count: core.admin.importGraves(await readJson(req, MAX_BACKUP_BODY)) });
        return;
      }
      if (method === 'POST') {
        const body = await readJson(req);
        if (path === '/api/admin/review') {
          send(res, 200, { ok: core.admin.review(body.plot, body.decision) });
          return;
        }
        if (path === '/api/admin/grave-create') {
          send(res, 201, core.admin.createGrave(body.plot, body.name, body.epitaph));
          return;
        }
        if (path === '/api/admin/grave-update') {
          send(res, 200, { ok: core.admin.updateGrave(body.plot, { name: body.name, epitaph: body.epitaph, stage: body.stage }) });
          return;
        }
        if (path === '/api/admin/grave-remove') {
          send(res, 200, { ok: core.admin.removeGrave(body.plot) });
          return;
        }
        if (path === '/api/admin/editor-code') {
          send(res, 201, core.admin.editorCode(body.plot));
          return;
        }
        if (path === '/api/admin/gift-crypt') {
          send(res, 201, core.admin.giftCrypt(body.zone, body.name));
          return;
        }
        if (path === '/api/admin/revoke-crypt') {
          send(res, 200, { ok: core.admin.revokeCrypt(body.zone) });
          return;
        }
        if (path === '/api/admin/epitaph') {
          send(res, 200, { ok: core.admin.reviewEpitaph(body.plot, body.approve === true) });
          return;
        }
        if (path === '/api/admin/renew') {
          send(res, 200, { ok: core.admin.renew(body.plot) });
          return;
        }
        if (path === '/api/admin/confirm') {
          send(res, 200, { ok: core.admin.confirmOrder(body.token) });
          return;
        }
        if (path === '/api/admin/attach') {
          send(res, 200, { ok: core.admin.attachPayment(body.paymentId, body.token) });
          return;
        }
        if (path === '/api/admin/report') {
          send(res, 200, { ok: core.admin.closeReport(body.id, body.hide === true) });
          return;
        }
      }
    }
    throw new UserError('not_found', 404);
  }

  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://local').pathname;
    try {
      if (path.startsWith('/api/') || path.startsWith('/webhooks/')) {
        await handleApi(req, res, path);
        return;
      }
      const file = req.method === 'GET' ? files.get(ROUTES[path] ?? path.slice(1)) : null;
      if (!file) throw new UserError('not_found', 404);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
      res.end(file.body);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof UserError) {
        send(res, err.status, { error: err.code });
        return;
      }
      console.error(err);
      send(res, 500, { error: 'server_error' });
    }
  });

  server.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(purge);
    unsubscribe();
  });
  server.closeClients = () => {
    for (const res of clients) res.end();
    clients.clear();
  };
  return server;
}
