import { createHash, randomBytes } from 'node:crypto';
import { GRID, UserError, featureOf } from './core.js';
import { validateNick, randomNick } from './nicks.js';

const VISITOR_TTL_MS = 12_000;
const MAX_VISITORS = 200;
const GHOST_EVERY_MS = 2 * 60_000;
const GHOST_LIFE_MS = 60_000;
const CATCH_DISTANCE = 0.7;
// A little above the real walking speed, so lag is forgiven but teleporting is not.
const MAX_SPEED = 4;
const TELEPORT_PENALTY_MS = 10_000;
const DUEL_RANGE = 1.6;
const DUEL_LIFE_MS = 25_000;
const DUEL_RESULT_MS = 7000;
const MOVES = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const BOARD_SIZE = 30;
const NOTE_LENGTH = 120;
const MIN_RECORD_MS = 5 * 60_000;
const TOP_SIZE = 5;

const distance = (a, b) => Math.hypot(a.c - b.c, a.r - b.r);
const publicId = (id) => createHash('sha256').update(id).digest('hex').slice(0, 12);

// Who is on the map and what they play. It lives in memory; the owner saves it with the season copy.
export function createGames({ now = Date.now, random = Math.random } = {}) {
  const visitors = new Map();
  const locked = new Set();
  const duels = new Map();
  const scores = new Map();
  let board = [];
  let record = null;
  let ghost = null;
  let nextGhost = now() + GHOST_EVERY_MS;

  function post(entry) {
    board = [{ ...entry, at: now() }, ...board].slice(0, BOARD_SIZE);
  }

  function score(nick, field) {
    const entry = scores.get(nick) ?? { ghosts: 0, duels: 0 };
    entry[field] += 1;
    scores.set(nick, entry);
  }

  function pathTiles() {
    const tiles = [];
    for (let plot = 0; plot < GRID.cols * GRID.rows; plot++) {
      if (featureOf(plot) === 'path') tiles.push({ c: plot % GRID.cols, r: Math.floor(plot / GRID.cols) });
    }
    return tiles;
  }

  function sweep() {
    const at = now();
    for (const [pub, visitor] of visitors) {
      if (at - visitor.seen <= VISITOR_TTL_MS) continue;
      visitors.delete(pub);
      const stayed = visitor.seen - visitor.first;
      if (stayed >= MIN_RECORD_MS && stayed > (record?.ms ?? 0)) {
        record = { nick: visitor.nick, ms: stayed };
        post({ kind: 'record', nick: visitor.nick, minutes: Math.round(stayed / 60_000) });
      }
    }
    for (const [id, duel] of duels) {
      if (at > duel.expires) duels.delete(id);
    }
    if (ghost && at > ghost.expires) {
      ghost = null;
      nextGhost = at + GHOST_EVERY_MS;
    }
    if (!ghost && visitors.size && at >= nextGhost) {
      const tiles = pathTiles();
      const tile = tiles[Math.floor(random() * tiles.length)];
      ghost = { ...tile, expires: at + GHOST_LIFE_MS };
    }
  }

  function requireVisitor(id) {
    const visitor = visitors.get(publicId(String(id)));
    if (!visitor) throw new UserError('not_found', 404);
    return visitor;
  }

  function duelOf(pub) {
    for (const duel of duels.values()) if (duel.a === pub || duel.b === pub) return duel;
    return null;
  }

  function duelView(pub) {
    const duel = duelOf(pub);
    if (!duel) return null;
    const mine = duel.a === pub ? 'a' : 'b';
    const theirs = mine === 'a' ? 'b' : 'a';
    const done = !!(duel.moves.a && duel.moves.b);
    return {
      id: duel.id,
      opponent: duel.nicks[theirs],
      mine: duel.moves[mine] ?? null,
      theirs: done ? duel.moves[theirs] : null,
      result: done ? (duel.winner === null ? 'draw' : duel.winner === mine ? 'win' : 'lose') : null,
    };
  }

  function resolve(duel) {
    const { a, b } = duel.moves;
    duel.winner = a === b ? null : BEATS[a] === b ? 'a' : 'b';
    duel.expires = now() + DUEL_RESULT_MS;
    if (duel.winner) {
      const loser = duel.winner === 'a' ? 'b' : 'a';
      score(duel.nicks[duel.winner], 'duels');
      post({ kind: 'duel', nick: duel.nicks[duel.winner], other: duel.nicks[loser] });
    }
  }

  function requireMove(move) {
    if (!MOVES.includes(move)) throw new UserError('bad_option');
    return move;
  }

  const top = (field) => [...scores.entries()]
    .filter(([, entry]) => entry[field] > 0)
    .sort((a, b) => b[1][field] - a[1][field])
    .slice(0, TOP_SIZE)
    .map(([nick, entry]) => ({ nick, count: entry[field] }));

  return {
    live(ownPub = null) {
      sweep();
      const list = [];
      for (const [pub, visitor] of visitors) if (pub !== ownPub) list.push({ id: pub, c: visitor.c, r: visitor.r, nick: visitor.nick });
      return { visitors: list, ghost: ghost ? { c: ghost.c, r: ghost.r } : null };
    },

    report({ id, c, r, nick, walking }) {
      const valid = /^[a-z0-9]{8,16}$/.test(String(id)) && Number.isFinite(c) && Number.isFinite(r) && c >= -1 && r >= -1 && c <= GRID.cols && r <= GRID.rows;
      if (!valid) throw new UserError('bad_option');
      const pub = publicId(id);
      const at = now();
      const known = visitors.get(pub);
      if (!known && visitors.size >= MAX_VISITORS) return { ...this.live(pub), you: null, duel: null };
      let cleanNick = known?.nick;
      if (!locked.has(pub) && nick) {
        try {
          cleanNick = validateNick(nick);
        } catch {
          // A nick that fails the filter is simply ignored here; the form reports it when it is set.
        }
      }
      cleanNick ??= randomNick(random);
      const visitor = { c: Math.round(c * 100) / 100, r: Math.round(r * 100) / 100, nick: cleanNick, first: known?.first ?? at, seen: at, suspectUntil: known?.suspectUntil ?? 0 };
      if (known && distance(known, visitor) > ((at - known.seen) / 1000) * MAX_SPEED + 0.5) visitor.suspectUntil = at + TELEPORT_PENALTY_MS;
      visitors.set(pub, visitor);
      if (ghost && walking === true && at > visitor.suspectUntil && distance(ghost, visitor) <= CATCH_DISTANCE) {
        ghost = null;
        nextGhost = at + GHOST_EVERY_MS;
        score(visitor.nick, 'ghosts');
        post({ kind: 'ghost', nick: visitor.nick });
      }
      return { ...this.live(pub), you: { id: pub, nick: visitor.nick, locked: locked.has(pub) }, duel: duelView(pub) };
    },

    challenge({ id, target, move }) {
      sweep();
      const me = requireVisitor(id);
      const pub = publicId(String(id));
      const rival = visitors.get(String(target));
      requireMove(move);
      if (!rival || String(target) === pub) throw new UserError('not_found', 404);
      if (distance(me, rival) > DUEL_RANGE) throw new UserError('too_far');
      if (duelOf(pub) || duelOf(String(target))) throw new UserError('duel_busy', 409);
      const duelId = randomBytes(6).toString('hex');
      duels.set(duelId, { id: duelId, a: pub, b: String(target), nicks: { a: me.nick, b: rival.nick }, moves: { a: move }, winner: null, expires: now() + DUEL_LIFE_MS });
      return duelView(pub);
    },

    answer({ id, duel: duelId, move }) {
      sweep();
      requireVisitor(id);
      const pub = publicId(String(id));
      const duel = duels.get(String(duelId));
      requireMove(move);
      if (!duel || duel.b !== pub) throw new UserError('not_found', 404);
      if (duel.moves.b) return duelView(pub);
      duel.moves.b = move;
      resolve(duel);
      return duelView(pub);
    },

    // Only names that passed the filter ever reach the map.
    checkNick(input) {
      return validateNick(input);
    },

    resetNick(pub) {
      const visitor = visitors.get(String(pub));
      if (!visitor) throw new UserError('not_found', 404);
      locked.add(String(pub));
      visitor.nick = randomNick(random);
      return true;
    },

    online() {
      sweep();
      return [...visitors.entries()].map(([id, visitor]) => ({ id, nick: visitor.nick, locked: locked.has(id) }));
    },

    board() {
      sweep();
      return { entries: board, ghosts: top('ghosts'), duels: top('duels'), record };
    },

    addNote(input) {
      const text = String(input ?? '').trim().replace(/\s+/g, ' ');
      if (!text || [...text].length > NOTE_LENGTH) throw new UserError('bad_note');
      post({ kind: 'note', text });
      return true;
    },

    removeEntry(at) {
      board = board.filter((entry) => entry.at !== Number(at));
      return true;
    },

    snapshot() {
      return { board, record, scores: [...scores.entries()], locked: [...locked] };
    },

    restore(season) {
      if (!season) return;
      board = Array.isArray(season.board) ? season.board.slice(0, BOARD_SIZE) : [];
      record = season.record ?? null;
      scores.clear();
      for (const [nick, entry] of Array.isArray(season.scores) ? season.scores : []) scores.set(String(nick), { ghosts: Number(entry?.ghosts) || 0, duels: Number(entry?.duels) || 0 });
      locked.clear();
      for (const pub of Array.isArray(season.locked) ? season.locked : []) locked.add(String(pub));
    },
  };
}
