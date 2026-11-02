import { chubrikColor, CHUBRIK_COUNT } from './render.js';

const WALK_SPEED = 2.6;
const STROLL_SPEED = 0.7;
const DIGGER_SPEED = 0.8;
const SMOOTHING = 4;
const NEAR_DISTANCE = 0.85;
const RIVAL_DISTANCE = 1.4;
const WALKING_REPORT_MS = 1200;
const STROLL_REPORT_MS = 4000;
const DUEL_REPORT_MS = 1000;
const ID_KEY = 'riperVisitor';
const NICK_KEY = 'riperNick';
const SOLID_FEATURES = new Set(['stage', 'shop', 'well', 'hut', 'board']);
const GRAVE_RADIUS = 0.3;
// Screen directions on an isometric map: "up" means both axes shrink, "right" moves along col and against row.
const KEY_DIRECTIONS = {
  w: [-1, -1], arrowup: [-1, -1], ц: [-1, -1],
  s: [1, 1], arrowdown: [1, 1], ы: [1, 1],
  a: [-1, 1], arrowleft: [-1, 1], ф: [-1, 1],
  d: [1, -1], arrowright: [1, -1], в: [1, -1],
};
// The gravedigger's rounds as col, row and how many seconds he works at that spot.
const DIGGER_ROUTE = [
  [3.5, 8, 8], [6.5, 8, 0], [6.5, 6.5, 0], [9.5, 6.5, 7], [9.5, 3.5, 7], [7, 3.5, 0], [7, 0.5, 8], [7, 3.5, 0],
  [4.5, 3.5, 7], [4.5, 4, 0], [0.5, 4, 7], [5.5, 4, 0], [5.5, 6.5, 7], [6.5, 6.5, 0], [6.5, 8, 0],
];

const legs = DIGGER_ROUTE.map((from, index) => {
  const to = DIGGER_ROUTE[(index + 1) % DIGGER_ROUTE.length];
  return { from, to, walk: Math.hypot(to[0] - from[0], to[1] - from[1]) / DIGGER_SPEED, stay: from[2] };
});
const ROUND_SECONDS = legs.reduce((sum, leg) => sum + leg.stay + leg.walk, 0);

// Worked out from the clock alone, so every viewer and the stream see him in about the same place.
export function diggerAt(timeMs, name) {
  let left = (timeMs / 1000) % ROUND_SECONDS;
  for (const { from, to, walk, stay } of legs) {
    if (left < stay) return { id: 'digger', digger: true, c: from[0], r: from[1], moving: false, nick: name };
    left -= stay;
    if (left < walk) {
      const share = left / walk;
      return { id: 'digger', digger: true, c: from[0] + (to[0] - from[0]) * share, r: from[1] + (to[1] - from[1]) * share, moving: true, nick: name };
    }
    left -= walk;
  }
  return { id: 'digger', digger: true, c: DIGGER_ROUTE[0][0], r: DIGGER_ROUTE[0][1], moving: false, nick: name };
}

const colorOf = (id) => {
  let sum = 0;
  for (const char of String(id)) sum += char.charCodeAt(0);
  return chubrikColor(sum % CHUBRIK_COUNT);
};

function stored(key, make) {
  try {
    const value = localStorage.getItem(key);
    if (value) return value;
    const fresh = make();
    if (fresh) localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return make();
  }
}

// Other visitors arrive every few seconds; between reports they glide instead of jumping.
export function createCrowd() {
  const people = new Map();
  return {
    update(list) {
      const seen = new Set();
      for (const { id, c, r, nick } of list) {
        seen.add(id);
        const person = people.get(id);
        if (person) Object.assign(person, { tc: c, tr: r, nick });
        else people.set(id, { id, c, r, tc: c, tr: r, nick, color: colorOf(id), phase: c * 3, moving: false, me: false });
      }
      for (const id of people.keys()) if (!seen.has(id)) people.delete(id);
    },
    tick(dt) {
      const share = Math.min(1, dt * SMOOTHING);
      for (const person of people.values()) {
        const dc = person.tc - person.c;
        const dr = person.tr - person.r;
        person.moving = Math.hypot(dc, dr) > 0.02;
        person.c += dc * share;
        person.r += dr * share;
      }
      return [...people.values()];
    },
  };
}

// This visitor's own chubrik: it strolls by itself until the person takes over with the keyboard.
export function createWalker({ scene, api, getState, diggerName, onNear, onMove, onLive, onRival }) {
  const makeId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 12);
  const id = stored(ID_KEY, makeId);
  const crowd = createCrowd();
  const me = { id, c: 7, r: 9, color: colorOf(id), phase: 0, moving: false, me: false, nick: null };
  const keys = new Set();
  let wantedNick = stored(NICK_KEY, () => null);
  let walking = false;
  let target = null;
  let lastFrame = performance.now();
  let lastReport = -Infinity;
  let nearPlot = null;
  let rival = null;
  let inDuel = false;
  let people = [];

  function plotAt(c, r) {
    const state = getState();
    const col = Math.round(c);
    const row = Math.round(r);
    if (!state || col < 0 || row < 0 || col >= state.grid.cols || row >= state.grid.rows) return null;
    return state.plots[row * state.grid.cols + col];
  }

  function blocked(c, r) {
    const state = getState();
    if (!state || c < -0.45 || r < -0.45 || c > state.grid.cols - 0.55 || r > state.grid.rows - 0.55) return true;
    const plot = plotAt(c, r);
    if (!plot) return true;
    if (plot.ad || SOLID_FEATURES.has(plot.feature)) return true;
    return plot.occupied && Math.hypot(c - Math.round(c), r - Math.round(r)) < GRAVE_RADIUS;
  }

  function step(dc, dr) {
    let moved = false;
    if (dc && !blocked(me.c + dc, me.r)) { me.c += dc; moved = true; }
    if (dr && !blocked(me.c, me.r + dr)) { me.r += dr; moved = true; }
    return moved;
  }

  function pickTarget() {
    const paths = getState()?.plots.filter((plot) => plot.feature === 'path' || plot.feature === 'hill') ?? [];
    const plot = paths[Math.floor(Math.random() * paths.length)];
    if (!plot) return null;
    const { cols } = getState().grid;
    return [plot.plot % cols, Math.floor(plot.plot / cols)];
  }

  function stroll(dt) {
    target ??= pickTarget();
    if (!target) return false;
    const dc = target[0] - me.c;
    const dr = target[1] - me.r;
    const distance = Math.hypot(dc, dr);
    if (distance < 0.1) {
      target = null;
      return false;
    }
    const moved = step((dc / distance) * STROLL_SPEED * dt, (dr / distance) * STROLL_SPEED * dt);
    if (!moved) target = null;
    return moved;
  }

  function walk(dt) {
    let dc = 0;
    let dr = 0;
    for (const key of keys) {
      const direction = KEY_DIRECTIONS[key];
      if (direction) {
        dc += direction[0];
        dr += direction[1];
      }
    }
    const length = Math.hypot(dc, dr);
    if (!length) return false;
    return step((dc / length) * WALK_SPEED * dt, (dr / length) * WALK_SPEED * dt);
  }

  function findNear() {
    const state = getState();
    if (!state) return null;
    let best = null;
    let bestDistance = NEAR_DISTANCE;
    const { cols, rows } = state.grid;
    for (let row = Math.max(0, Math.round(me.r) - 1); row <= Math.min(rows - 1, Math.round(me.r) + 1); row++) {
      for (let col = Math.max(0, Math.round(me.c) - 1); col <= Math.min(cols - 1, Math.round(me.c) + 1); col++) {
        const plot = state.plots[row * cols + col];
        if (!plot.grave && !plot.ad && !SOLID_FEATURES.has(plot.feature)) continue;
        const distance = Math.hypot(me.c - col, me.r - row);
        if (distance < bestDistance) {
          best = plot.plot;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  function findRival() {
    let best = null;
    let bestDistance = RIVAL_DISTANCE;
    for (const person of people) {
      const distance = Math.hypot(person.c - me.c, person.r - me.r);
      if (distance < bestDistance) {
        best = person;
        bestDistance = distance;
      }
    }
    return best;
  }

  async function report(time) {
    const every = inDuel ? DUEL_REPORT_MS : walking ? WALKING_REPORT_MS : STROLL_REPORT_MS;
    if (document.hidden || time - lastReport < every) return;
    lastReport = time;
    try {
      const live = await api('/api/live', { id, c: me.c, r: me.r, nick: wantedNick, walking });
      crowd.update(live.visitors);
      if (live.you) me.nick = live.you.nick;
      inDuel = !!live.duel;
      onLive(live);
    } catch {
      // A missed report only makes the other visitors stand still for a moment.
    }
  }

  function frame(time) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (time - lastFrame) / 1000);
    lastFrame = time;
    me.moving = walking ? walk(dt) : stroll(dt);
    me.me = walking;
    people = crowd.tick(dt);
    scene.setVisitors([...people, me, diggerAt(Date.now(), diggerName())]);
    report(time);
    if (walking) {
      if (me.moving) onMove(me.c, me.r);
      const near = findNear();
      if (near !== nearPlot) {
        nearPlot = near;
        onNear(near);
      }
      const nextRival = findRival();
      if (nextRival?.id !== rival?.id) {
        rival = nextRival;
        onRival(rival);
      }
    }
  }
  requestAnimationFrame(frame);

  const typing = (event) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || document.querySelector('dialog[open]');

  window.addEventListener('keydown', (event) => {
    if (!walking || typing(event)) return;
    const key = event.key.toLowerCase();
    if (KEY_DIRECTIONS[key]) {
      keys.add(key);
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  return {
    id,
    get walking() {
      return walking;
    },
    get nearPlot() {
      return nearPlot;
    },
    get nick() {
      return me.nick;
    },
    isTyping: typing,
    setWalking(on) {
      walking = on;
      keys.clear();
      target = null;
      nearPlot = null;
      rival = null;
      onNear(null);
      onRival(null);
      if (on) onMove(me.c, me.r);
    },
    setNick(nick) {
      wantedNick = nick;
      me.nick = nick;
      try {
        localStorage.setItem(NICK_KEY, nick);
      } catch {}
    },
    press(key, down) {
      if (down) keys.add(key);
      else keys.delete(key);
    },
  };
}
