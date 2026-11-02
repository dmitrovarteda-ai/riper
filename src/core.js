import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt } from 'node:crypto';

export const GRID = { cols: 15, rows: 8 };
export const CURRENCY = 'rub';
// Monthly subscription levels; each includes everything from the level below it.
export const PRODUCTS = {
  tier_1: { price: 200, tier: 1, title: 'Riper: level 1' },
  tier_2: { price: 300, tier: 2, title: 'Riper: level 2' },
  tier_3: { price: 400, tier: 3, title: 'Riper: level 3' },
  tier_4: { price: 500, tier: 4, title: 'Riper: level 4' },
  tier_5: { price: 3000, tier: 5, title: 'Riper: VIP crypt' },
};
export const CENTER_MIN_TIER = 3;
// Large 2×2 plots kept for future advertisers: they cannot be rented as graves.
export const AD_ZONES = [
  { id: 'north-west', col: 1, row: 1 },
  { id: 'north-east', col: 12, row: 1 },
  { id: 'south-west', col: 1, row: 5 },
  { id: 'south-east', col: 12, row: 5 },
];
// Each option names the lowest subscription level that unlocks it.
export const COLORS = { stone: 1, marble: 1, obsidian: 1, gold: 2, rose: 2, neon: 3, ice: 3 };
export const STYLES = { cross: 1, slab: 3, obelisk: 4 };
export const ITEMS = {
  candle: 1, skull: 1, pebble: 1,
  rose: 2, tulip: 2, violet: 2, pumpkin: 2, raven: 2,
  lantern: 3, coffin: 3, bat: 3, ghost: 3,
  crown: 4, ufo: 4, disco: 4,
};
export const ITEM_LIMITS = { 1: 3, 2: 8, 3: 15, 4: 30, 5: 40 };
export const CRYPT_TIER = 5;
export const FENCE_MIN_TIER = 3;
export const EPITAPH_MIN_TIER = 2;
const TILE_HALF_X = 36;
const TILE_HALF_Y = 18;
export const CARE_ACTIONS = ['clean', 'wash', 'tidy'];

const WEEK = 7 * 24 * 3600 * 1000;
const MAX_STAGE = 3;
const MONTH = 31 * 24 * 3600 * 1000;
const RELEASE_AFTER_MONTHS = 3;
// Stripe needs at least 30 minutes; the plot stays reserved a little longer than the checkout lives.
export const CHECKOUT_MS = 31 * 60 * 1000;
const RESERVE_MS = 32 * 60 * 1000;
const CARE_COOLDOWN_MS = 30 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const GRAVE_COLUMNS = [
  'plot', 'name', 'code_hash', 'status', 'care_anchor', 'last_care', 'tier', 'paid_until', 'buyer_ref', 'color', 'style',
  'fence', 'items', 'epitaph', 'epitaph_pending', 'link', 'link_pending', 'demo_stage', 'editor_hash', 'created_at',
];

export class UserError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const hashCode = (code) => createHash('sha256').update(code).digest('hex');

export function normalizeCode(input) {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function validateName(input) {
  const name = String(input ?? '').trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < 2 || length > 24 || !/^[\p{L}\p{N} ._'-]+$/u.test(name)) throw new UserError('bad_name');
  return name;
}

function validateEpitaph(input) {
  const text = String(input ?? '').trim().replace(/\s+/g, ' ');
  if ([...text].length > 40 || !/^[\p{L}\p{N} .,!?:;'"()-]*$/u.test(text)) throw new UserError('bad_epitaph');
  return text;
}

function validateItems(input, tier) {
  if (!Array.isArray(input)) throw new UserError('bad_option');
  if (input.length > ITEM_LIMITS[tier]) throw new UserError('too_many_items');
  return input.map((item) => {
    const type = String(item?.type ?? '');
    const x = Number(item?.x);
    const y = Number(item?.y);
    if (!Object.hasOwn(ITEMS, type) || !Number.isInteger(x) || !Number.isInteger(y)) throw new UserError('bad_option');
    if (ITEMS[type] > tier) throw new UserError('needs_higher_tier', 403);
    const inside = tier === CRYPT_TIER
      ? Math.abs(x) <= 70 && y >= 2 && y <= 46
      : Math.abs(x) / TILE_HALF_X + Math.abs(y) / TILE_HALF_Y <= 1;
    if (!inside) throw new UserError('bad_option');
    return { type, x, y };
  });
}

function validateLink(input) {
  const link = String(input ?? '').trim();
  if (!link) return '';
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new UserError('bad_link');
  }
  if (url.protocol !== 'https:' || link.length > 200) throw new UserError('bad_link');
  return url.href;
}

function cleanBuyerRef(input) {
  const ref = String(input ?? '').trim();
  return ref ? ref.slice(0, 60) : null;
}

export function adZoneOf(plot) {
  const col = plot % GRID.cols;
  const row = Math.floor(plot / GRID.cols);
  return AD_ZONES.find((zone) => col >= zone.col && col <= zone.col + 1 && row >= zone.row && row <= zone.row + 1) ?? null;
}

// Tiles that belong to the cemetery itself: alleys, the band's stage and the special places.
export const STAGE = { col: 6, row: 3, cols: 3, rows: 2 };
export function featureOf(plot) {
  const col = plot % GRID.cols;
  const row = Math.floor(plot / GRID.cols);
  if (col >= STAGE.col && col < STAGE.col + STAGE.cols && row >= STAGE.row && row < STAGE.row + STAGE.rows) return 'stage';
  if (col === 8 && row === 6) return 'shop';
  if (col === 6 && row === 6) return 'well';
  return col === 7 || row === 4 ? 'path' : null;
}

export function isCenter(plot) {
  const col = plot % GRID.cols;
  const row = Math.floor(plot / GRID.cols);
  return col >= 4 && col <= 10 && row >= 2 && row <= 5;
}

export function stageOf(careAnchor, now) {
  return Math.min(MAX_STAGE, Math.max(0, Math.floor((now - careAnchor) / WEEK)));
}

// After a subscription ends the grave falls apart month by month, however well it was kept.
export function effectiveStage(row, now) {
  if (row.demo_stage !== null && row.demo_stage !== undefined) return row.demo_stage;
  const cared = row.tier === CRYPT_TIER ? 0 : stageOf(row.care_anchor, now);
  if (now <= row.paid_until) return cared;
  return Math.max(cared, Math.min(MAX_STAGE, Math.floor((now - row.paid_until) / MONTH) + 1));
}

export function createCore({ dbPath = ':memory:', now = Date.now, reserveMs = RESERVE_MS } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS graves (
      plot INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      care_anchor INTEGER NOT NULL,
      last_care INTEGER NOT NULL DEFAULT 0,
      tier INTEGER NOT NULL,
      paid_until INTEGER NOT NULL,
      buyer_ref TEXT,
      color TEXT NOT NULL DEFAULT 'stone',
      style TEXT NOT NULL DEFAULT 'cross',
      fence INTEGER NOT NULL DEFAULT 0,
      items TEXT NOT NULL DEFAULT '[]',
      epitaph TEXT,
      epitaph_pending TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      token TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      plot INTEGER NOT NULL,
      name TEXT,
      status TEXT NOT NULL,
      code TEXT,
      stripe_session TEXT,
      number TEXT,
      buyer_ref TEXT,
      paid_at INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      email TEXT,
      order_token TEXT,
      product TEXT,
      amount INTEGER,
      currency TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plot INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plot INTEGER NOT NULL,
      reason TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  // Databases created before crypts existed need these columns added.
  const columns = new Set(db.prepare('PRAGMA table_info(graves)').all().map((column) => column.name));
  for (const name of ['link', 'link_pending']) {
    if (!columns.has(name)) db.exec(`ALTER TABLE graves ADD COLUMN ${name} TEXT`);
  }
  if (!columns.has('demo_stage')) db.exec('ALTER TABLE graves ADD COLUMN demo_stage INTEGER');
  if (!columns.has('editor_hash')) db.exec('ALTER TABLE graves ADD COLUMN editor_hash TEXT');

  const listeners = new Set();

  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function emit(message) {
    for (const listener of listeners) listener(message);
  }

  function addEvent(plot, type) {
    const createdAt = now();
    run('INSERT INTO events (plot, type, created_at) VALUES (?, ?, ?)', plot, type, createdAt);
    const grave = get('SELECT name, status FROM graves WHERE plot = ?', plot);
    if (grave?.status === 'approved') emit({ type, plot, name: grave.name, at: createdAt });
  }

  function publicGrave(row) {
    const approved = row.status === 'approved';
    return {
      plot: row.plot,
      visible: approved,
      name: approved ? row.name : null,
      stage: effectiveStage(row, now()),
      tier: row.tier,
      fence: !!row.fence,
      style: row.style,
      color: row.color,
      items: JSON.parse(row.items),
      epitaph: approved ? row.epitaph : null,
      crypt: row.tier === CRYPT_TIER,
      link: approved ? row.link : null,
    };
  }

  function generateCode() {
    let code = '';
    for (let i = 0; i < 10; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return code;
  }

  function graveByCode(code) {
    const normalized = normalizeCode(code);
    const hash = hashCode(normalized);
    const row = normalized ? get('SELECT * FROM graves WHERE code_hash = ? OR editor_hash = ?', hash, hash) : null;
    if (!row) throw new UserError('bad_code', 401);
    return row;
  }

  function plotTaken(plot) {
    if (get('SELECT 1 AS x FROM graves WHERE plot = ?', plot)) return true;
    return !!get(`SELECT 1 AS x FROM orders WHERE plot = ? AND status = 'pending' AND name IS NOT NULL AND expires_at > ?`, plot, now());
  }

  // A grave from before the alleys existed, or from an old copy, moves to the nearest regular plot.
  function moveOffFeatures() {
    const total = GRID.cols * GRID.rows;
    for (const { plot } of all('SELECT plot FROM graves')) {
      if (!featureOf(plot)) continue;
      const free = Array.from({ length: total }, (_, index) => index)
        .filter((index) => !featureOf(index) && !adZoneOf(index) && !plotTaken(index))
        .sort((a, b) => Math.abs(a - plot) - Math.abs(b - plot))[0];
      if (free === undefined) continue;
      run('UPDATE graves SET plot = ? WHERE plot = ?', free, plot);
      run('UPDATE events SET plot = ? WHERE plot = ?', free, plot);
      run('UPDATE reports SET plot = ? WHERE plot = ?', free, plot);
    }
  }
  moveOffFeatures();

  function fulfil(order) {
    const { tier } = PRODUCTS[order.product];
    const at = now();
    if (order.name) {
      if (get('SELECT 1 AS x FROM graves WHERE plot = ?', order.plot)) return false;
      const code = generateCode();
      run(
        `INSERT INTO graves (plot, name, code_hash, status, care_anchor, tier, paid_until, buyer_ref, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        order.plot, order.name, hashCode(code), at, tier, at + MONTH, order.buyer_ref, at,
      );
      run(`UPDATE orders SET status = 'paid', code = ?, paid_at = ? WHERE token = ?`, code, at, order.token);
    } else {
      if (!get('SELECT 1 AS x FROM graves WHERE plot = ?', order.plot)) return false;
      run('UPDATE graves SET tier = ?, buyer_ref = COALESCE(?, buyer_ref) WHERE plot = ?', tier, order.buyer_ref, order.plot);
      run(`UPDATE orders SET status = 'paid', paid_at = ? WHERE token = ?`, at, order.token);
      addEvent(order.plot, 'tier_up');
    }
    emit({ type: 'changed' });
    return true;
  }

  function makeOrder({ product, plot, name, buyerRef }) {
    const token = randomBytes(24).toString('base64url');
    const number = generateCode().slice(0, 6);
    const at = now();
    run(
      `INSERT INTO orders (token, product, plot, name, number, buyer_ref, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      token, product, plot, name ?? null, number, buyerRef ?? null, at, at + reserveMs,
    );
    return { token, number, product, tier: PRODUCTS[product].tier, price: PRODUCTS[product].price };
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    state() {
      const graves = all('SELECT * FROM graves').map(publicGrave);
      const byPlot = new Map(graves.map((g) => [g.plot, g]));
      const plots = [];
      for (let plot = 0; plot < GRID.cols * GRID.rows; plot++) {
        const grave = byPlot.get(plot);
        const ad = adZoneOf(plot)?.id ?? null;
        const feature = featureOf(plot);
        plots.push({ plot, center: isCenter(plot), ad, feature, taken: !!ad || !!feature || !!grave || plotTaken(plot), grave: grave?.visible ? grave : null, occupied: !!grave });
      }
      const recent = all(
        `SELECT e.plot, e.type, e.created_at AS at, g.name FROM events e JOIN graves g ON g.plot = e.plot
         WHERE g.status = 'approved' ORDER BY e.id DESC LIMIT 10`,
      );
      return { grid: GRID, plots, recent, ads: AD_ZONES };
    },

    products() {
      return Object.fromEntries(Object.entries(PRODUCTS).map(([key, p]) => [key, { price: p.price, tier: p.tier }]));
    },

    createGraveOrder({ plot, name, consent, buyerRef, tier }) {
      const index = Number(plot);
      if (!Number.isInteger(index) || index < 0 || index >= GRID.cols * GRID.rows) throw new UserError('bad_plot');
      if (adZoneOf(index)) throw new UserError('plot_reserved', 409);
      if (featureOf(index)) throw new UserError('plot_feature', 409);
      if (consent !== true) throw new UserError('consent_required');
      const cleanName = validateName(name);
      const minTier = isCenter(index) ? CENTER_MIN_TIER : 1;
      const level = tier === undefined ? minTier : Number(tier);
      if (!PRODUCTS[`tier_${level}`] || level === CRYPT_TIER) throw new UserError('bad_tier');
      if (level < minTier) throw new UserError('center_needs_tier');
      return tx(() => {
        if (plotTaken(index)) throw new UserError('plot_taken', 409);
        return makeOrder({ product: `tier_${level}`, plot: index, name: cleanName, buyerRef: cleanBuyerRef(buyerRef) });
      });
    },

    createCryptOrder({ zone, name, consent, buyerRef }) {
      const target = AD_ZONES.find((item) => item.id === zone);
      if (!target) throw new UserError('bad_plot');
      if (consent !== true) throw new UserError('consent_required');
      const cleanName = validateName(name);
      const anchor = target.row * GRID.cols + target.col;
      return tx(() => {
        if (plotTaken(anchor)) throw new UserError('plot_taken', 409);
        return makeOrder({ product: `tier_${CRYPT_TIER}`, plot: anchor, name: cleanName, buyerRef: cleanBuyerRef(buyerRef) });
      });
    },

    createUpgradeOrder({ code, tier, buyerRef }) {
      const product = PRODUCTS[`tier_${Number(tier)}`];
      if (!product || product.tier === CRYPT_TIER) throw new UserError('bad_tier');
      const grave = graveByCode(code);
      if (product.tier <= grave.tier) throw new UserError('already_owned', 409);
      return makeOrder({ product: `tier_${product.tier}`, plot: grave.plot, buyerRef: cleanBuyerRef(buyerRef) });
    },

    order(token) {
      const row = get('SELECT token, number, product, plot, status, code FROM orders WHERE token = ?', String(token));
      if (!row) throw new UserError('not_found', 404);
      return { ...row, tier: PRODUCTS[row.product].tier, price: PRODUCTS[row.product].price };
    },

    devPay(token) {
      return tx(() => {
        const order = get(`SELECT * FROM orders WHERE token = ? AND status = 'pending'`, String(token));
        if (!order) throw new UserError('not_found', 404);
        if (!fulfil(order)) throw new UserError('plot_taken', 409);
        return true;
      });
    },

    attachCheckout(token, sessionId) {
      run('UPDATE orders SET stripe_session = ? WHERE token = ?', sessionId, String(token));
    },

    checkoutOf(token) {
      const row = get(`SELECT stripe_session AS session, status FROM orders WHERE token = ?`, String(token));
      if (!row) throw new UserError('not_found', 404);
      return row;
    },

    cancelOrder(token) {
      run(`DELETE FROM orders WHERE token = ? AND status = 'pending'`, String(token));
      emit({ type: 'changed' });
    },

    // The webhook and the return page can both report one session, so a repeat must change nothing.
    applyCheckout({ id, token, paymentStatus, amountTotal, currency, email }) {
      if (paymentStatus !== 'paid') return 'unpaid';
      return tx(() => {
        const paymentId = `stripe:${id}`;
        if (get('SELECT 1 AS x FROM payments WHERE id = ?', paymentId)) return 'duplicate';
        const order = get(`SELECT * FROM orders WHERE token = ? AND status = 'pending' AND stripe_session = ?`, String(token), String(id));
        const product = order ? PRODUCTS[order.product] : null;
        const exact = product && amountTotal === product.price * 100 && currency === CURRENCY;
        const status = exact && fulfil(order) ? 'matched' : 'unmatched';
        run(
          'INSERT INTO payments (id, email, order_token, product, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          paymentId, email ?? null, String(token), order?.product ?? null, amountTotal ?? null, currency ?? null, status, now(),
        );
        return status;
      });
    },

    // Joke graves for the beta: always approved, with a fixed look that never decays or expires.
    seedDemo(list) {
      return tx(() => {
        // Only an empty cemetery is filled, so a restart never undoes the owner's edits.
        if (get('SELECT 1 AS x FROM graves LIMIT 1')) return 0;
        const at = now();
        for (const item of list) {
          validateName(item.name);
          const code = generateCode();
          run('DELETE FROM graves WHERE plot = ?', item.plot);
          run(
            `INSERT INTO graves (plot, name, code_hash, status, care_anchor, tier, paid_until, color, style, fence, items, epitaph, demo_stage, created_at)
             VALUES (?, ?, ?, 'approved', ?, 4, ?, ?, ?, ?, ?, ?, ?, ?)`,
            item.plot, item.name, hashCode(code), at, at + 3650 * 24 * 3600 * 1000, item.color, item.style, item.fence ? 1 : 0,
            JSON.stringify(validateItems(item.items, 4)), validateEpitaph(item.epitaph), item.stage, at,
          );
        }
        emit({ type: 'changed' });
        return list.length;
      });
    },

    grave(code) {
      const row = graveByCode(code);
      return {
        ...publicGrave(row),
        ownName: row.name,
        status: row.status,
        paidUntil: row.paid_until,
        lapsed: now() > row.paid_until,
        epitaphPending: row.epitaph_pending,
        linkPending: row.link_pending,
        ownEpitaph: row.epitaph,
        ownLink: row.link,
        releaseAt: row.paid_until + RELEASE_AFTER_MONTHS * MONTH,
        careReadyIn: Math.max(0, row.last_care + CARE_COOLDOWN_MS - now()),
      };
    },

    care(code, action) {
      if (!CARE_ACTIONS.includes(action)) throw new UserError('bad_action');
      return tx(() => {
        const row = graveByCode(code);
        const at = now();
        if (row.tier === CRYPT_TIER) throw new UserError('bad_action');
        if (at > row.paid_until) throw new UserError('subscription_ended', 403);
        if (at - row.last_care < CARE_COOLDOWN_MS) throw new UserError('care_cooldown', 429);
        const stage = stageOf(row.care_anchor, at);
        const anchor = stage === 0 ? at : at - (stage - 1) * WEEK;
        run('UPDATE graves SET care_anchor = ?, last_care = ? WHERE plot = ?', anchor, at, row.plot);
        addEvent(row.plot, `care_${action}`);
        emit({ type: 'changed' });
        return { stage: stageOf(anchor, at) };
      });
    },

    customize(code, { color, style, fence, items, epitaph, link }) {
      return tx(() => {
        const row = graveByCode(code);
        if (now() > row.paid_until) throw new UserError('subscription_ended', 403);
        const unlocked = (table, key) => {
          if (!Object.hasOwn(table, key)) throw new UserError('bad_option');
          if (table[key] > row.tier) throw new UserError('needs_higher_tier', 403);
          return key;
        };
        const nextColor = color === undefined ? row.color : unlocked(COLORS, color);
        const nextStyle = style === undefined ? row.style : unlocked(STYLES, style);
        if (fence === true && row.tier < FENCE_MIN_TIER) throw new UserError('needs_higher_tier', 403);
        const nextFence = fence === undefined ? row.fence : (fence === true ? 1 : 0);
        const nextItems = items === undefined ? row.items : JSON.stringify(validateItems(items, row.tier));
        let pending = row.epitaph_pending;
        let shown = row.epitaph;
        if (epitaph !== undefined) {
          if (row.tier < EPITAPH_MIN_TIER) throw new UserError('needs_higher_tier', 403);
          const text = validateEpitaph(epitaph);
          // Removing text is always safe; new text waits for review before it can reach the stream.
          pending = text || null;
          if (!text) shown = null;
        }
        let linkPending = row.link_pending;
        let linkShown = row.link;
        if (link !== undefined) {
          if (row.tier !== CRYPT_TIER) throw new UserError('needs_higher_tier', 403);
          const clean = validateLink(link);
          linkPending = clean || null;
          if (!clean) linkShown = null;
        }
        run(
          'UPDATE graves SET color = ?, style = ?, fence = ?, items = ?, epitaph = ?, epitaph_pending = ?, link = ?, link_pending = ? WHERE plot = ?',
          nextColor, nextStyle, nextFence, nextItems, shown, pending, linkShown, linkPending, row.plot,
        );
        // A quiet change: the stream only shows a grave when the owner of the cemetery says so.
        emit({ type: 'changed' });
        return true;
      });
    },

    rename(code, name) {
      const row = graveByCode(code);
      if (row.status !== 'rejected') throw new UserError('rename_not_allowed', 409);
      run(`UPDATE graves SET name = ?, status = 'pending' WHERE plot = ?`, validateName(name), row.plot);
      return true;
    },

    report(plot, reason) {
      const index = Number(plot);
      const text = String(reason ?? '').trim().slice(0, 500);
      if (!Number.isInteger(index) || !text) throw new UserError('bad_report');
      if (!get('SELECT 1 AS x FROM graves WHERE plot = ?', index)) throw new UserError('not_found', 404);
      run('INSERT INTO reports (plot, reason, created_at) VALUES (?, ?, ?)', index, text, now());
      return true;
    },

    admin: {
      queue() {
        return {
          graves: all(`SELECT plot, name, status, created_at FROM graves WHERE status = 'pending' ORDER BY created_at`),
          payments: all(`SELECT id, email, order_token, product, amount, currency, created_at FROM payments WHERE status = 'unmatched' ORDER BY created_at`),
          orders: all(`SELECT token, number, buyer_ref, product, plot, name, created_at FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100`),
          reports: all(`SELECT r.id, r.plot, r.reason, r.created_at, g.name FROM reports r LEFT JOIN graves g ON g.plot = r.plot WHERE r.resolved = 0 ORDER BY r.created_at`),
          allGraves: all('SELECT plot, name, epitaph, tier, demo_stage FROM graves ORDER BY plot'),
          crypts: AD_ZONES.map((zone) => {
            const row = get('SELECT name, epitaph FROM graves WHERE plot = ?', zone.row * GRID.cols + zone.col);
            return { id: zone.id, name: row?.name ?? null, epitaph: row?.epitaph ?? null };
          }),
          epitaphs: all('SELECT plot, name, epitaph_pending, link_pending FROM graves WHERE epitaph_pending IS NOT NULL OR link_pending IS NOT NULL ORDER BY plot'),
          subscribers: all('SELECT plot, name, buyer_ref, tier, paid_until FROM graves ORDER BY paid_until LIMIT 500'),
        };
      },
      review(plot, decision) {
        if (!['approved', 'rejected'].includes(decision)) throw new UserError('bad_decision');
        return tx(() => {
          const row = get('SELECT status FROM graves WHERE plot = ?', Number(plot));
          if (!row) throw new UserError('not_found', 404);
          run('UPDATE graves SET status = ? WHERE plot = ?', decision, Number(plot));
          if (decision === 'approved') addEvent(Number(plot), 'buried');
          emit({ type: 'changed' });
          return true;
        });
      },
      reviewEpitaph(plot, approve) {
        return tx(() => {
          const row = get('SELECT epitaph_pending, link_pending FROM graves WHERE plot = ?', Number(plot));
          if (!row || (!row.epitaph_pending && !row.link_pending)) throw new UserError('not_found', 404);
          if (approve) {
            run(
              'UPDATE graves SET epitaph = COALESCE(epitaph_pending, epitaph), link = COALESCE(link_pending, link), epitaph_pending = NULL, link_pending = NULL WHERE plot = ?',
              Number(plot),
            );
          } else {
            run('UPDATE graves SET epitaph_pending = NULL, link_pending = NULL WHERE plot = ?', Number(plot));
          }
          emit({ type: 'changed' });
          return true;
        });
      },
      // A full copy of the cemetery, for hosts without a permanent disk.
      exportGraves() {
        return { version: 1, graves: all(`SELECT ${GRAVE_COLUMNS.join(', ')} FROM graves ORDER BY plot`) };
      },
      importGraves(copy) {
        if (copy?.version !== 1 || !Array.isArray(copy.graves)) throw new UserError('bad_backup');
        return tx(() => {
          run('DELETE FROM graves');
          const insert = db.prepare(`INSERT INTO graves (${GRAVE_COLUMNS.join(', ')}) VALUES (${GRAVE_COLUMNS.map(() => '?').join(', ')})`);
          for (const row of copy.graves) {
            try {
              insert.run(...GRAVE_COLUMNS.map((column) => row[column] ?? null));
            } catch {
              throw new UserError('bad_backup');
            }
          }
          moveOffFeatures();
          emit({ type: 'changed' });
          return copy.graves.length;
        });
      },
      // Owner tools for the beta: their changes need no order and no review.
      createGrave(plot, name, epitaph) {
        const index = Number(plot);
        if (!Number.isInteger(index) || index < 0 || index >= GRID.cols * GRID.rows) throw new UserError('bad_plot');
        if (adZoneOf(index)) throw new UserError('plot_reserved', 409);
        if (featureOf(index)) throw new UserError('plot_feature', 409);
        const cleanName = validateName(name);
        const cleanEpitaph = validateEpitaph(epitaph) || null;
        return tx(() => {
          if (plotTaken(index)) throw new UserError('plot_taken', 409);
          const code = generateCode();
          const at = now();
          run(
            `INSERT INTO graves (plot, name, code_hash, status, care_anchor, tier, paid_until, epitaph, demo_stage, created_at) VALUES (?, ?, ?, 'approved', ?, 4, ?, ?, 0, ?)`,
            index, cleanName, hashCode(code), at, at + 3650 * 24 * 3600 * 1000, cleanEpitaph, at,
          );
          addEvent(index, 'buried');
          emit({ type: 'changed' });
          return { code, plot: index };
        });
      },
      updateGrave(plot, { name, epitaph, stage }) {
        return tx(() => {
          const row = get('SELECT * FROM graves WHERE plot = ?', Number(plot));
          if (!row) throw new UserError('not_found', 404);
          const nextName = name === undefined ? row.name : validateName(name);
          const nextEpitaph = epitaph === undefined ? row.epitaph : validateEpitaph(epitaph) || null;
          let nextStage = row.demo_stage;
          if (stage !== undefined && row.tier !== CRYPT_TIER) {
            nextStage = Number(stage);
            if (![0, 1, 2, 3].includes(nextStage)) throw new UserError('bad_option');
          }
          run(
            `UPDATE graves SET name = ?, epitaph = ?, epitaph_pending = NULL, demo_stage = ?, status = 'approved' WHERE plot = ?`,
            nextName, nextEpitaph, nextStage, Number(plot),
          );
          emit({ type: 'changed' });
          return true;
        });
      },
      removeGrave(plot) {
        return tx(() => {
          const removed = run('DELETE FROM graves WHERE plot = ?', Number(plot));
          if (!removed.changes) throw new UserError('not_found', 404);
          run('DELETE FROM events WHERE plot = ?', Number(plot));
          run('DELETE FROM reports WHERE plot = ?', Number(plot));
          emit({ type: 'changed' });
          return true;
        });
      },
      // A separate key for the owner: opening the editor never breaks the code a viewer was given.
      editorCode(plot) {
        const code = generateCode();
        const changed = run('UPDATE graves SET editor_hash = ? WHERE plot = ?', hashCode(code), Number(plot));
        if (!changed.changes) throw new UserError('not_found', 404);
        return { code };
      },
      // Beta only: the owner hands a crypt to someone for free. It needs no order and no review.
      giftCrypt(zoneId, name) {
        const zone = AD_ZONES.find((item) => item.id === zoneId);
        if (!zone) throw new UserError('bad_plot');
        const cleanName = validateName(name);
        const anchor = zone.row * GRID.cols + zone.col;
        return tx(() => {
          if (plotTaken(anchor)) throw new UserError('plot_taken', 409);
          const code = generateCode();
          const at = now();
          run(
            `INSERT INTO graves (plot, name, code_hash, status, care_anchor, tier, paid_until, color, created_at) VALUES (?, ?, ?, 'approved', ?, ?, ?, 'marble', ?)`,
            anchor, cleanName, hashCode(code), at, CRYPT_TIER, at + 3650 * 24 * 3600 * 1000, at,
          );
          addEvent(anchor, 'buried');
          emit({ type: 'changed' });
          return { code };
        });
      },
      revokeCrypt(zoneId) {
        const zone = AD_ZONES.find((item) => item.id === zoneId);
        if (!zone) throw new UserError('bad_plot');
        return tx(() => {
          const anchor = zone.row * GRID.cols + zone.col;
          const removed = run('DELETE FROM graves WHERE plot = ? AND tier = ?', anchor, CRYPT_TIER);
          if (!removed.changes) throw new UserError('not_found', 404);
          run('DELETE FROM events WHERE plot = ?', anchor);
          run('DELETE FROM reports WHERE plot = ?', anchor);
          emit({ type: 'changed' });
          return true;
        });
      },
      // Boosty has no API here, so the owner marks who is still subscribed.
      renew(plot) {
        return tx(() => {
          const row = get('SELECT paid_until FROM graves WHERE plot = ?', Number(plot));
          if (!row) throw new UserError('not_found', 404);
          run('UPDATE graves SET paid_until = ? WHERE plot = ?', Math.max(row.paid_until, now()) + MONTH, Number(plot));
          emit({ type: 'changed' });
          return true;
        });
      },
      confirmOrder(token) {
        return tx(() => {
          const order = get(`SELECT * FROM orders WHERE token = ? AND status = 'pending'`, String(token));
          if (!order) throw new UserError('not_found', 404);
          if (!fulfil(order)) throw new UserError('plot_taken', 409);
          return true;
        });
      },
      attachPayment(paymentId, token) {
        return tx(() => {
          const payment = get(`SELECT * FROM payments WHERE id = ? AND status = 'unmatched'`, String(paymentId));
          const order = get(`SELECT * FROM orders WHERE token = ? AND status = 'pending'`, String(token));
          if (!payment || !order) throw new UserError('not_found', 404);
          if (payment.product !== order.product) throw new UserError('product_mismatch', 409);
          if (!fulfil(order)) throw new UserError('plot_taken', 409);
          run(`UPDATE payments SET status = 'matched' WHERE id = ?`, payment.id);
          return true;
        });
      },
      closeReport(id, hide) {
        return tx(() => {
          const report = get('SELECT plot FROM reports WHERE id = ?', Number(id));
          if (!report) throw new UserError('not_found', 404);
          run('UPDATE reports SET resolved = 1 WHERE id = ?', Number(id));
          if (hide) {
            run(`UPDATE graves SET status = 'rejected' WHERE plot = ?`, report.plot);
            emit({ type: 'changed' });
          }
          return true;
        });
      },
    },

    purge() {
      const at = now();
      const released = run('DELETE FROM graves WHERE paid_until < ?', at - RELEASE_AFTER_MONTHS * MONTH);
      if (released.changes) emit({ type: 'changed' });
      run(`UPDATE orders SET code = NULL WHERE code IS NOT NULL AND paid_at < ?`, at - WEEK);
      run(`UPDATE orders SET buyer_ref = NULL WHERE paid_at < ?`, at - 30 * 24 * 3600 * 1000);
      run(`DELETE FROM orders WHERE status = 'pending' AND expires_at < ?`, at - WEEK);
      run(`UPDATE payments SET email = NULL WHERE created_at < ?`, at - 30 * 24 * 3600 * 1000);
      run(`DELETE FROM events WHERE created_at < ?`, at - 30 * 24 * 3600 * 1000);
    },

    close() {
      db.close();
    },
  };
}
