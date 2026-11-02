// Isometric pixel art drawn in code on a low-res canvas and scaled up by CSS.
const STEP_X = 36;
const STEP_Y = 18;
const TILE_P = 9;
const MARGIN_X = 48;
const SKY = 96;
const ISLAND_DEPTH = 18;
const FRAME_MS = 80;

const STONE = [
  ['#c3c6d4', '#8d90a3', '#6d7084'],
  ['#a9abb6', '#7c7e8e', '#5f6172'],
  ['#8b8a8c', '#666569', '#4c4b52'],
  ['#6c6a68', '#4e4c4c', '#393739'],
];
const GRASS = [
  ['#3f7a55', '#37704c'],
  ['#4b7350', '#426949'],
  ['#5a6e45', '#51633e'],
  ['#5f5f3e', '#555437'],
];
const IRON = ['#3a3d4c', '#262833', '#1d1f28'];
const SOIL = ['#57402f', '#3f2e22', '#2f2219'];

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

// Upper and lower edge of a p × q iso footprint at column offset dx from its center.
function edges(dx, p, q) {
  const north = 2 * (q - p);
  const south = 2 * (p - q);
  return [-p - q + Math.abs(dx - north) / 2, p + q - Math.abs(dx - south) / 2];
}

// A crisp iso box: columns are filled one by one, so edges stay pixel-sharp.
function box(ctx, cx, cy, p, q, h, z, [top, left, right]) {
  const half = 2 * (p + q);
  const south = 2 * (p - q);
  const base = cy - z;
  for (let dx = -half; dx < half; dx++) {
    const [upper, lower] = edges(dx + 0.5, p, q);
    const x = Math.round(cx + dx);
    const topY = Math.round(base - h + upper);
    const lowY = Math.round(base - h + lower);
    rect(ctx, x, topY, 1, Math.max(1, lowY - topY), top);
    if (h > 0) rect(ctx, x, lowY, 1, Math.max(1, Math.round(h)), dx + 0.5 < south ? left : right);
  }
}

function tileCenter(layout, col, row) {
  return [layout.ox + (col - row) * STEP_X, layout.oy + (col + row) * STEP_Y];
}

function diamond(ctx, cx, cy, p, q, color, seed) {
  const half = 2 * (p + q);
  const r = seed ? rng(seed) : null;
  for (let dx = -half; dx < half; dx++) {
    const [upper, lower] = edges(dx + 0.5, p, q);
    const topY = Math.round(cy + upper);
    const lowY = Math.round(cy + lower);
    rect(ctx, cx + dx, topY, 1, Math.max(1, lowY - topY), color[0]);
    if (r) {
      for (let y = topY; y < lowY; y += 3) {
        if (r() < 0.22) rect(ctx, cx + dx, y, 1, 1, color[1]);
      }
    }
  }
}

function outlineTile(ctx, cx, cy, color) {
  ctx.fillStyle = color;
  for (let dx = -STEP_X; dx < STEP_X; dx++) {
    const [upper, lower] = edges(dx + 0.5, TILE_P, TILE_P);
    ctx.fillRect(Math.round(cx + dx), Math.round(cy + upper), 1, 1);
    ctx.fillRect(Math.round(cx + dx), Math.round(cy + lower) - 1, 1, 1);
  }
}

const COLOR_BASE = {
  stone: STONE[0],
  marble: ['#f2f1ea', '#c4c2b8', '#9a988f'],
  obsidian: ['#4a4658', '#2c2938', '#1c1a26'],
  gold: ['#f6d271', '#c0943a', '#8c6a26'],
  rose: ['#f3a3c2', '#c56f92', '#94506d'],
  neon: ['#7dffb0', '#2fc47a', '#1b8553'],
  ice: ['#b6ecff', '#6db6d9', '#4a87a6'],
};

function darken(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.round(((value >> shift) & 255) * (1 - amount));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

// Any stone colour fades with neglect, so an abandoned gold grave still looks abandoned.
function stoneFor(color, stage) {
  if (!color || color === 'stone') return STONE[stage];
  const amount = [0, 0.15, 0.32, 0.5][stage];
  return (COLOR_BASE[color] ?? STONE[0]).map((shade) => darken(shade, amount));
}

const WILTED = '#6a4a3c';

function drawFlower(ctx, x, y, stage, colors) {
  rect(ctx, x, y - 2, 1, 3, stage < 2 ? '#4f9a60' : '#54503a');
  if (stage === 3) return;
  const [petal, center] = stage === 2 ? [WILTED, WILTED] : colors;
  rect(ctx, x - 1, y - 3, 3, 1, petal);
  rect(ctx, x, y - 4, 1, 3, petal);
  rect(ctx, x, y - 3, 1, 1, center);
}

// Items are drawn around (x, y), the point on the ground where they were placed.
function drawItem(ctx, x, y, type, stage) {
  const lit = stage < 2;
  switch (type) {
    case 'candle':
      rect(ctx, x, y - 4, 2, 4, '#e8e2cf');
      if (lit) {
        rect(ctx, x, y - 6, 2, 2, '#ffb547');
        rect(ctx, x + 1, y - 7, 1, 1, '#fff0a8');
      }
      break;
    case 'skull':
      rect(ctx, x - 2, y - 5, 5, 4, '#e8e4d6');
      rect(ctx, x - 1, y - 1, 3, 1, '#c8c4b4');
      rect(ctx, x - 1, y - 4, 1, 1, '#1c1a20');
      rect(ctx, x + 1, y - 4, 1, 1, '#1c1a20');
      break;
    case 'pebble':
      rect(ctx, x - 2, y - 2, 5, 2, '#8d90a3');
      rect(ctx, x - 1, y - 3, 3, 1, '#c3c6d4');
      break;
    case 'rose':
      drawFlower(ctx, x, y, stage, ['#e8405f', '#ffd65a']);
      break;
    case 'tulip':
      drawFlower(ctx, x, y, stage, ['#ffd65a', '#ff8f3f']);
      break;
    case 'violet':
      drawFlower(ctx, x, y, stage, ['#b56cf0', '#ffe9a8']);
      break;
    case 'pumpkin':
      rect(ctx, x - 3, y - 5, 7, 5, lit ? '#e8842c' : '#8a5a2c');
      rect(ctx, x, y - 6, 1, 1, '#4f7a3a');
      rect(ctx, x - 1, y - 4, 1, 1, lit ? '#ffe27a' : '#2a2018');
      rect(ctx, x + 2, y - 4, 1, 1, lit ? '#ffe27a' : '#2a2018');
      rect(ctx, x - 1, y - 2, 4, 1, lit ? '#ffe27a' : '#2a2018');
      break;
    case 'raven':
      rect(ctx, x - 2, y - 5, 5, 4, '#15141c');
      rect(ctx, x + 2, y - 7, 3, 3, '#15141c');
      rect(ctx, x + 5, y - 6, 2, 1, '#d9a53a');
      rect(ctx, x - 4, y - 3, 2, 1, '#15141c');
      rect(ctx, x + 3, y - 6, 1, 1, '#ffffff');
      rect(ctx, x, y - 1, 1, 1, '#d9a53a');
      break;
    case 'lantern':
      rect(ctx, x, y - 8, 1, 8, '#262833');
      rect(ctx, x - 1, y - 11, 3, 3, lit ? '#ffd98a' : '#5a5040');
      rect(ctx, x - 1, y - 12, 3, 1, '#262833');
      break;
    case 'coffin':
      rect(ctx, x - 5, y - 4, 11, 4, '#5b3a26');
      rect(ctx, x - 5, y - 5, 11, 1, '#7a5236');
      rect(ctx, x, y - 4, 1, 4, '#c9a24a');
      break;
    case 'crown':
      rect(ctx, x - 3, y - 2, 7, 2, '#f0c566');
      rect(ctx, x - 3, y - 4, 1, 2, '#f0c566');
      rect(ctx, x, y - 5, 1, 3, '#f0c566');
      rect(ctx, x + 3, y - 4, 1, 2, '#f0c566');
      rect(ctx, x, y - 1, 1, 1, '#d8486f');
      break;
    case 'disco':
      rect(ctx, x, y - 16, 1, 5, '#6a6f85');
      rect(ctx, x - 3, y - 11, 7, 6, '#c9d3e8');
      rect(ctx, x - 2, y - 10, 1, 1, '#ff6fa8');
      rect(ctx, x + 1, y - 9, 1, 1, '#6fd8ff');
      rect(ctx, x - 1, y - 7, 1, 1, '#ffe27a');
      rect(ctx, x + 2, y - 7, 1, 1, '#9dff8f');
      break;
    default:
  }
}

const FLOATING = new Set(['ghost', 'bat', 'ufo']);

function drawBat(ctx, x, y, time) {
  const flap = Math.floor(time / 180) % 2;
  rect(ctx, x - 1, y - 2, 3, 3, '#1c1a26');
  rect(ctx, x - 4, y - 2 + flap, 3, 1, '#1c1a26');
  rect(ctx, x + 2, y - 2 + flap, 3, 1, '#1c1a26');
  rect(ctx, x - 1, y - 1, 1, 1, '#ff5d5d');
  rect(ctx, x + 1, y - 1, 1, 1, '#ff5d5d');
}

function drawFloating(ctx, x, y, type, time, phase) {
  const bob = Math.round(Math.sin(time / 500 + phase) * 2);
  if (type === 'ghost') drawGhost(ctx, x, y - 10 + bob);
  else if (type === 'bat') drawBat(ctx, x, y - 16 + bob, time);
  else drawUfo(ctx, x, y - 28 + bob, time);
}

function drawGhost(ctx, x, y) {
  rect(ctx, x - 3, y - 7, 6, 7, 'rgba(236, 244, 255, 0.82)');
  rect(ctx, x - 2, y - 9, 4, 2, 'rgba(236, 244, 255, 0.82)');
  rect(ctx, x - 3, y, 2, 1, 'rgba(236, 244, 255, 0.6)');
  rect(ctx, x + 1, y, 2, 1, 'rgba(236, 244, 255, 0.6)');
  rect(ctx, x - 2, y - 6, 1, 2, '#1c2030');
  rect(ctx, x + 1, y - 6, 1, 2, '#1c2030');
}

function drawUfo(ctx, x, y, time) {
  rect(ctx, x - 7, y - 2, 14, 2, '#aab2c8');
  rect(ctx, x - 3, y - 5, 6, 3, '#8ff0d0');
  const blink = Math.floor(time / 300) % 3;
  [-5, 0, 5].forEach((dx, index) => rect(ctx, x + dx, y - 1, 1, 1, index === blink ? '#ffe27a' : '#5a6078'));
  ctx.fillStyle = 'rgba(143, 240, 208, 0.12)';
  for (let i = 0; i < 16; i++) ctx.fillRect(Math.round(x - 3 - i / 3), y + i, Math.round(6 + (i * 2) / 3), 1);
}

// Turning the camera by 90° swaps a box's sides, and ground points rotate around the plot center.
const sides = (rot, p, q) => (rot % 2 ? [q, p] : [p, q]);

export function rotatePoint(x, y, rot) {
  let a = (x / STEP_X + y / STEP_Y) / 2;
  let b = (y / STEP_Y - x / STEP_X) / 2;
  for (let i = 0; i < rot; i++) [a, b] = [b, -a];
  return [Math.round((a - b) * STEP_X), Math.round((a + b) * STEP_Y)];
}

function drawCross(ctx, x, y, stage, color, rot) {
  const stone = stoneFor(color, stage);
  box(ctx, x, y - 1, 1.75, 1.75, 2, 0, stone);
  if (stage === 3) {
    box(ctx, x, y - 1, 0.75, 0.75, 7, 2, stone);
    box(ctx, x + 11, y + 4, 2, 0.5, 1, 0, stone);
    return;
  }
  const lean = stage === 2 ? 2 : 0;
  box(ctx, x, y - 1, 0.75, 0.75, 10, 2, stone);
  box(ctx, x + lean, y - 1, 0.75, 0.75, 9, 12, stone);
  box(ctx, x + lean, y - 1, ...sides(rot, 2.75, 0.75), 2, 15, stone);
  if (stage === 2) rect(ctx, x, y - 10, 1, 5, '#201e22');
}

function drawMonument(ctx, x, y, stage, color, rot, hires) {
  const stone = stoneFor(color, stage);
  box(ctx, x, y - 1, ...sides(rot, 4, 2), 2, 0, stone);
  if (stage === 3) {
    box(ctx, x - 2, y - 1, 2, 1, 7, 2, stone);
    box(ctx, x + 12, y + 4, 2, 1, 2, 0, stone);
    return;
  }
  box(ctx, x, y - 1, ...sides(rot, 3.5, 1), 15, 2, stone);
  box(ctx, x, y - 1, ...sides(rot, 2.5, 1), 2, 17, stone);
  box(ctx, x, y - 1, ...sides(rot, 1.25, 1), 2, 19, stone);
  if (!hires && rot === 0) {
    rect(ctx, x - 7, y - 11, 5, 1, stone[2]);
    rect(ctx, x - 7, y - 8, 5, 1, stone[2]);
  }
  if (stage === 2) {
    rect(ctx, x + 4, y - 16, 1, 6, '#201e22');
    rect(ctx, x + 5, y - 10, 1, 4, '#201e22');
  }
}

function drawObelisk(ctx, x, y, stage, color) {
  const stone = stoneFor(color, stage);
  box(ctx, x, y - 1, 3, 3, 3, 0, stone);
  if (stage === 3) {
    box(ctx, x, y - 1, 1.5, 1.5, 8, 3, stone);
    box(ctx, x + 12, y + 4, 2, 1, 2, 0, stone);
    return;
  }
  box(ctx, x, y - 1, 1.75, 1.75, 6, 3, stone);
  box(ctx, x, y - 1, 1.25, 1.25, 8, 9, stone);
  box(ctx, x, y - 1, 1, 1, 8, 17, stone);
  box(ctx, x, y - 1, 0.5, 0.5, 4, 25, stone);
  if (stage === 2) rect(ctx, x + 2, y - 18, 1, 7, '#201e22');
}

const PLAQUE_SPOT = [-8, 6];

function drawPlaque(ctx, x, y, stage, color, rot) {
  const [px, py] = rotatePoint(...PLAQUE_SPOT, rot);
  const stone = stoneFor(color === 'obsidian' ? 'marble' : color, stage);
  box(ctx, x + px, y + py, ...sides(rot, 2.5, 0.5), 5, 0, stone);
}

const IRON_FENCE = ['#3a3d4c', '#262833', '#1d1f28', '#9a9fb3'];
const RUSTY_FENCE = ['#6a4a35', '#4c3526', '#37261b', '#7a5a44'];

function fencePost(ctx, x, y, palette, height = 7) {
  const px = Math.round(x);
  const py = Math.round(y);
  rect(ctx, px, py - height, 1, height, palette[0]);
  rect(ctx, px + 1, py - height, 1, height, palette[1]);
  rect(ctx, px, py - height - 1, 2, 1, palette[3]);
}

function fenceRail(ctx, x0, y0, x1, y1, lift, color) {
  const steps = Math.max(1, Math.round(Math.abs(x1 - x0)));
  ctx.fillStyle = color;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    ctx.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t) - lift, 1, 1);
  }
}

// One straight run of fence. Neglect removes whole sections, so the gaps look like real damage.
function fenceRun(ctx, from, to, sections, stage, r, height = 7) {
  const palette = stage < 2 ? IRON_FENCE : RUSTY_FENCE;
  const missing = [0, 0.04, 0.22, 0.5][stage];
  let previous = null;
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    const standing = r() >= missing;
    if (standing && previous) {
      fenceRail(ctx, previous[0], previous[1], x, y, height - 2, palette[0]);
      fenceRail(ctx, previous[0], previous[1], x, y, 2, palette[1]);
    }
    if (standing) fencePost(ctx, x, y, palette, height);
    previous = standing ? [x, y] : null;
  }
}

function drawFence(ctx, cx, cy, plot, stage, side) {
  const north = [cx, cy - STEP_Y + 2];
  const east = [cx + STEP_X - 4, cy];
  const south = [cx, cy + STEP_Y - 2];
  const west = [cx - STEP_X + 4, cy];
  const r = rng(plot + 31 + (side === 'front' ? 100 : 0));
  if (side === 'back') {
    fenceRun(ctx, west, north, 4, stage, r);
    fenceRun(ctx, north, east, 4, stage, r);
  } else {
    fenceRun(ctx, west, south, 4, stage, r);
    fenceRun(ctx, south, east, 4, stage, r);
  }
}

function drawNeglect(ctx, cx, cy, plot, stage) {
  if (stage === 0) return;
  const r = rng(plot + 77);
  const count = [0, 18, 44, 80][stage];
  for (let i = 0; i < count; i++) {
    const a = (r() - 0.5) * 2;
    const b = (r() - 0.5) * 2;
    const x = cx + (a - b) * 16;
    const y = cy + (a + b) * 8;
    if (stage === 1) {
      rect(ctx, x, y, 2, 1, r() > 0.5 ? '#b5813f' : '#7b5a35');
    } else {
      rect(ctx, x, y - 3 - Math.floor(r() * stage), 1, 3 + stage, r() > 0.4 ? '#6f8e42' : '#8c8238');
    }
  }
}

function drawLantern(ctx, x, y) {
  box(ctx, x, y, 0.25, 0.25, 15, 0, IRON);
  box(ctx, x, y, 0.75, 0.75, 4, 15, ['#ffd98a', '#f0a53c', '#c67c22']);
  box(ctx, x, y, 1, 1, 1, 19, IRON);
}

function drawPlot(ctx, cx, cy, { plot, center, occupied, grave }, rot = 0, hires = false) {
  const stage = grave?.stage ?? 0;
  const ground = center ? ['#4a8a60', '#3f7c55'] : GRASS[stage];
  diamond(ctx, cx, cy, TILE_P, TILE_P, grave ? GRASS[stage] : ground, plot + 1);
  if (!occupied) {
    box(ctx, cx, cy, 5, 3.5, 1, 0, SOIL);
    return;
  }
  if (!grave) {
    box(ctx, cx, cy, 5, 3.5, 2, 0, SOIL);
    box(ctx, cx, cy - 2, 0.5, 0.5, 8, 2, ['#8f7a5a', '#6e5c42', '#544532']);
    return;
  }
  if (grave.fence) drawFence(ctx, cx, cy, plot, stage, 'back');
  box(ctx, cx, cy + 3, 6, 4, 1, 0, stage < 2 ? SOIL : ['#4c4230', '#393125', '#2b251b']);
  const placed = (grave.items ?? [])
    .filter((item) => !FLOATING.has(item.type))
    .map((item) => {
      const [x, y] = rotatePoint(item.x, item.y, rot);
      return { type: item.type, x, y };
    })
    .sort((a, b) => a.y - b.y);
  const plaque = grave.style !== 'slab' && grave.epitaph && stage < 3;
  const plaqueInFront = plaque && rotatePoint(...PLAQUE_SPOT, rot)[1] >= 0;
  for (const item of placed) if (item.y < -1) drawItem(ctx, cx + item.x, cy + item.y, item.type, stage);
  if (plaque && !plaqueInFront) drawPlaque(ctx, cx, cy, stage, grave.color, rot);
  if (grave.style === 'slab') drawMonument(ctx, cx, cy, stage, grave.color, rot, hires);
  else if (grave.style === 'obelisk') drawObelisk(ctx, cx, cy, stage, grave.color);
  else drawCross(ctx, cx, cy, stage, grave.color, rot);
  if (plaqueInFront) drawPlaque(ctx, cx, cy, stage, grave.color, rot);
  for (const item of placed) if (item.y >= -1) drawItem(ctx, cx + item.x, cy + item.y, item.type, stage);
  drawNeglect(ctx, cx, cy, plot, stage);
  if (grave.fence) drawFence(ctx, cx, cy, plot, stage, 'front');
}

const AD_STONE = ['#a9a4b8', '#77728a', '#5a5570'];
const AD_ROOF = ['#4a4560', '#35304a', '#262238'];

// A mausoleum on a 2×2 plot with a big sign on its left face.
function drawAdZone(ctx, cx, cy, label) {
  box(ctx, cx, cy, 15, 15, 3, 0, AD_STONE);
  box(ctx, cx, cy, 12, 12, 24, 3, AD_STONE);
  box(ctx, cx, cy, 14, 14, 3, 27, AD_ROOF);
  box(ctx, cx, cy, 9, 9, 4, 30, AD_ROOF);
  box(ctx, cx, cy, 4, 4, 3, 34, ['#f0c566', '#b58a38', '#8a6728']);

  // Door and columns on the right face.
  ctx.save();
  ctx.transform(1, -0.5, 0, 1, cx, cy + 24 - 27);
  ctx.fillStyle = '#231f30';
  ctx.fillRect(15, 7, 16, 17);
  ctx.fillStyle = '#d9d4e4';
  ctx.fillRect(5, 0, 4, 24);
  ctx.fillRect(37, 0, 4, 24);
  ctx.fillStyle = '#f0c566';
  ctx.fillRect(22.5, 14, 1, 4);
  ctx.restore();

  // The sign follows the left face, so it reads as part of the building.
  ctx.save();
  ctx.transform(1, 0.5, 0, 1, cx - 45, cy - 22);
  ctx.fillStyle = '#f0c566';
  ctx.fillRect(0, 0, 42, 16);
  ctx.fillStyle = '#17162a';
  ctx.fillRect(1, 1, 40, 14);
  ctx.fillStyle = '#ffe9a8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 9px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(label, 21, 8.5, 38);
  ctx.restore();
}

// The band's place on the map, in tile coordinates, and each player's spot on the stage.
const BAND_CENTER = [7, 3.5];
const BAND_SPOTS = [[-0.75, 0.75, 'guitar'], [-0.6, 0.15, 'drums'], [0.1, 0.1, 'singer'], [0.25, -0.5, 'bass'], [0.75, -0.75, 'organ']];
const STAGE_HEIGHT = 6;

function drawStage(ctx, cx, cy) {
  box(ctx, cx, cy, 25, 16, STAGE_HEIGHT, 0, ['#6b4a2c', '#4d3420', '#3b2718']);
  for (let i = -20; i <= 20; i += 8) box(ctx, cx + i * 2, cy + i, 0.5, 15, 0, STAGE_HEIGHT, ['#5a3e25', '#5a3e25', '#5a3e25']);
}

function drawShop(ctx, cx, cy) {
  box(ctx, cx, cy, 6, 6, 13, 0, ['#7a5636', '#5d3f27', '#49301d']);
  box(ctx, cx, cy, 8, 8, 2, 13, ['#c43d5a', '#962c44', '#752234']);
  box(ctx, cx, cy, 1, 1, 8, 15, ['#f6d271', '#c0943a', '#8c6a26']);
  rect(ctx, cx - 5, cy - 19, 10, 2, '#f6d271');
  rect(ctx, cx + 12, cy - 5, 2, 9, '#c3c6d4');
  rect(ctx, cx + 10, cy - 3, 6, 2, '#c3c6d4');
}

function drawWell(ctx, cx, cy) {
  box(ctx, cx, cy, 5, 5, 6, 0, ['#4fb6d9', '#7c7e8e', '#5f6172']);
  rect(ctx, cx - 11, cy - 20, 1, 15, '#4a3a30');
  rect(ctx, cx + 10, cy - 20, 1, 15, '#4a3a30');
  box(ctx, cx, cy, 6, 6, 2, 20, ['#7a5636', '#5d3f27', '#49301d']);
}

const BONE = '#e9e6d8';
const BONE_DARK = '#1c1a26';

function drawInstrument(ctx, x, y, role, swing, lift) {
  if (role === 'guitar') {
    rect(ctx, x - 3, y - 9, 5, 3, '#c0502f');
    rect(ctx, x + 2, y - 11, 6, 1, '#8a6728');
    rect(ctx, x + 1, y - 9 + swing, 3, 1, BONE);
  } else if (role === 'bass') {
    rect(ctx, x + 4, y - 7, 5, 6, '#7a4a26');
    rect(ctx, x + 6, y - 17, 1, 11, '#3a2a1f');
    rect(ctx, x + 1, y - 7 + swing, 3, 1, BONE);
  } else if (role === 'drums') {
    rect(ctx, x - 7, y - 6, 14, 6, '#c43d5a');
    rect(ctx, x - 3, y - 5, 6, 4, BONE);
    rect(ctx, x - 10, y - 10, 5, 1, '#f0c566');
    rect(ctx, x + 6, y - 10, 5, 1, '#f0c566');
    rect(ctx, x - 5, y - 11 - swing, 1, 3, '#caa56a');
    rect(ctx, x + 5, y - 10 - (1 - swing), 1, 3, '#caa56a');
  } else if (role === 'organ') {
    rect(ctx, x - 7, y - 8, 14, 4, '#3a2a1f');
    rect(ctx, x - 6, y - 8, 12, 1, BONE);
    rect(ctx, x - 6, y - 4, 2, 4, '#3a2a1f');
    rect(ctx, x + 4, y - 4, 2, 4, '#3a2a1f');
    rect(ctx, x - 3 + swing * 4, y - 9, 2, 1, BONE);
  } else {
    rect(ctx, x + 4, y - 12, 1, 12, '#6d7084');
    rect(ctx, x + 3, y - 14, 3, 2, '#3a3d4c');
    rect(ctx, x - 5, y - 13 - lift, 3, 1, BONE);
    rect(ctx, x + 2, y - 11, 2, 1, BONE);
  }
}

// One band member, feet at (x, y). Everything keeps to a whole-pixel grid and moves on the beat.
function drawSkeleton(ctx, x, y, time, role, phase) {
  const beat = Math.floor(time / 280 + phase);
  const bob = beat % 2;
  const swing = Math.floor(time / 160 + phase) % 2;
  rect(ctx, x - 2, y - 6, 1, 6, BONE);
  rect(ctx, x + 1, y - 6, 1, 6, BONE);
  rect(ctx, x - 3, y - 1, 2, 1, BONE);
  rect(ctx, x + 1, y - 1, 2, 1, BONE);
  rect(ctx, x - 2, y - 7, 4, 1, BONE);
  rect(ctx, x, y - 12 - bob, 1, 5 + bob, BONE);
  rect(ctx, x - 2, y - 11 - bob, 5, 1, BONE);
  rect(ctx, x - 2, y - 9 - bob, 5, 1, BONE);
  rect(ctx, x - 2, y - 17 - bob, 5, 4, BONE);
  rect(ctx, x - 1, y - 13 - bob, 3, 1, BONE);
  rect(ctx, x - 1, y - 16 - bob, 1, 1, BONE_DARK);
  rect(ctx, x + 1, y - 16 - bob, 1, 1, BONE_DARK);
  drawInstrument(ctx, x, y, role, swing, bob);
}

const CHUBRIK_COLORS = ['#e86a6a', '#6ac1e8', '#8fdc6a', '#c98ae8', '#e8b86a', '#6ae8c4', '#e88ac1', '#9aa3e8'];

// A tiny visitor with a round head, a little hoodie and legs that move only while walking.
function drawChubrik(ctx, x, y, time, { color, moving, me, phase = 0 }) {
  const step = moving ? Math.floor(time / 130 + phase) % 2 : 0;
  const bob = moving ? step : 0;
  rect(ctx, x - 3, y, 7, 1, 'rgba(0, 0, 0, 0.35)');
  rect(ctx, x - 2, y - 2 + step, 2, 2 - step, '#262833');
  rect(ctx, x + 1, y - 2 + (1 - step) * (moving ? 1 : 0), 2, moving ? 1 + step : 2, '#262833');
  rect(ctx, x - 3, y - 7 - bob, 7, 5, color);
  rect(ctx, x - 4, y - 6 - bob, 1, 3, color);
  rect(ctx, x + 4, y - 6 - bob, 1, 3, color);
  rect(ctx, x - 2, y - 11 - bob, 5, 4, '#f3d9b8');
  rect(ctx, x - 3, y - 12 - bob, 7, 2, color);
  rect(ctx, x - 1, y - 9 - bob, 1, 1, BONE_DARK);
  rect(ctx, x + 1, y - 9 - bob, 1, 1, BONE_DARK);
  if (me) {
    const lift = Math.floor(time / 300) % 2;
    rect(ctx, x - 2, y - 18 - lift, 5, 1, '#ffe27a');
    rect(ctx, x - 1, y - 17 - lift, 3, 1, '#ffe27a');
    rect(ctx, x, y - 16 - lift, 1, 1, '#ffe27a');
  }
}

function drawTree(ctx, x, y, seed) {
  const r = rng(seed);
  box(ctx, x, y, 0.75, 0.75, 20, 0, ['#4a3a30', '#3a2c25', '#2a201b']);
  const branch = (bx, by, dir, length) => {
    for (let i = 0; i < length; i++) rect(ctx, bx + dir * i, by - Math.floor(i * 0.7), 2, 2, '#2f241f');
  };
  branch(x - 1, y - 16, -1, 10 + Math.floor(r() * 5));
  branch(x + 1, y - 19, 1, 11 + Math.floor(r() * 5));
  branch(x, y - 22, -1, 7);
  branch(x, y - 24, 1, 6);
}

function drawCypress(ctx, x, y) {
  box(ctx, x, y, 0.5, 0.5, 4, 0, ['#4a3a30', '#3a2c25', '#2a201b']);
  [[4, 2.5], [9, 2.5], [14, 2], [19, 1.5], [24, 1], [29, 0.5]].forEach(([z, size]) => {
    box(ctx, x, y, size, size, 5, z, ['#2d5a48', '#20463a', '#183529']);
  });
}

function drawSky(ctx, layout) {
  const gradient = ctx.createLinearGradient(0, 0, 0, layout.height);
  gradient.addColorStop(0, '#141a33');
  gradient.addColorStop(0.45, '#2a2a50');
  gradient.addColorStop(1, '#3d3355');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, layout.width, layout.height);
  const moonX = Math.round(layout.width * 0.8);
  [[34, '#2f3560'], [26, '#3f4470'], [20, '#d9dcc8']].forEach(([radius, color]) => {
    ctx.fillStyle = color;
    for (let y = -radius; y <= radius; y++) {
      const half = Math.round(Math.sqrt(radius * radius - y * y));
      ctx.fillRect(moonX - half, 52 + y, half * 2, 1);
    }
  });
  rect(ctx, moonX - 8, 44, 5, 4, '#b9bca8');
  rect(ctx, moonX + 5, 56, 6, 4, '#b9bca8');
  rect(ctx, moonX - 3, 62, 3, 3, '#b9bca8');
  ctx.fillStyle = '#1b1e38';
  for (let x = 0; x < layout.width; x++) {
    const hill = 34 + Math.sin(x * 0.018) * 14 + Math.sin(x * 0.051) * 5;
    ctx.fillRect(x, Math.round(SKY + 40 - hill), 1, layout.height);
  }
}

export function computeLayout({ cols, rows }) {
  const width = (cols + rows) * STEP_X + MARGIN_X * 2;
  const height = (cols + rows) * STEP_Y + SKY + ISLAND_DEPTH + 30;
  return { width, height, cols, rows, ox: MARGIN_X + rows * STEP_X, oy: SKY + STEP_Y };
}

export function plotAtPoint(layout, x, y) {
  const a = (x - layout.ox) / STEP_X;
  const b = (y - layout.oy) / STEP_Y;
  const col = Math.round((a + b) / 2);
  const row = Math.round((b - a) / 2);
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null;
  return row * layout.cols + col;
}

function drawWorld(ctx, layout, state, adLabel) {
  const { cols, rows } = layout;
  drawSky(ctx, layout);
  const [gridX, gridY] = tileCenter(layout, (cols - 1) / 2, (rows - 1) / 2);
  const p = (cols * TILE_P);
  const q = (rows * TILE_P);
  // The ground is one raised block; its side faces are what gives the scene depth.
  box(ctx, gridX, gridY + ISLAND_DEPTH, p + 1.5, q + 1.5, ISLAND_DEPTH, 0, ['#2f4a3a', '#4a3527', '#35261c']);
  const north = tileCenter(layout, -0.5, -0.5);
  const east = tileCenter(layout, cols - 0.5, -0.5);
  const south = tileCenter(layout, cols - 0.5, rows - 0.5);
  const west = tileCenter(layout, -0.5, rows - 0.5);
  const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  [0.08, 0.3, 0.55, 0.82].forEach((t, index) => {
    const [x, y] = along(north, east, t);
    drawTree(ctx, x + 6, y - 7, index + 1);
  });
  [0.2, 0.62].forEach((t) => {
    const [x, y] = along(west, north, t);
    drawCypress(ctx, x - 6, y - 7);
  });
  drawCypress(ctx, north[0], north[1] - 10);
  const fenceRandom = rng(19);
  fenceRun(ctx, west, north, rows * 2, 0, fenceRandom, 9);
  fenceRun(ctx, north, east, cols * 2, 0, fenceRandom, 9);

  const ordered = [...state.plots].sort((a, b) => {
    const da = (a.plot % cols) + Math.floor(a.plot / cols);
    const db = (b.plot % cols) + Math.floor(b.plot / cols);
    return da - db;
  });
  for (const plot of ordered) {
    const col = plot.plot % cols;
    const row = Math.floor(plot.plot / cols);
    const [cx, cy] = tileCenter(layout, col, row);
    if (plot.ad) {
      diamond(ctx, cx, cy, TILE_P, TILE_P, ['#55527a', '#4a4770'], plot.plot + 1);
      const zone = state.ads.find((item) => item.id === plot.ad);
      // Its last tile in paint order, so the building sits on top of the whole plot.
      if (col === zone.col + 1 && row === zone.row + 1) {
        const [zx, zy] = tileCenter(layout, zone.col + 0.5, zone.row + 0.5);
        drawAdZone(ctx, zx, zy, state.plots[zone.row * cols + zone.col].grave?.name || adLabel);
      }
    } else if (plot.feature) {
      diamond(ctx, cx, cy, TILE_P, TILE_P, ['#8b8069', '#74694f'], plot.plot + 1);
      if (plot.feature === 'shop') drawShop(ctx, cx, cy);
      if (plot.feature === 'well') drawWell(ctx, cx, cy);
      // The stage's last tile in paint order, like the crypts.
      if (plot.feature === 'stage' && col === 8 && row === 4) {
        const [sx, sy] = tileCenter(layout, BAND_CENTER[0], BAND_CENTER[1]);
        drawStage(ctx, sx, sy);
      }
    } else {
      drawPlot(ctx, cx, cy, plot);
    }
  }

  const lanterns = [[3.5, 1.5], [10.5, 1.5], [3.5, 5.5], [10.5, 5.5]];
  const glows = lanterns.map(([col, row]) => tileCenter(layout, col, row));
  for (const [x, y] of glows) drawLantern(ctx, x, y);

  // The gate is a gap in the middle of the front-left side.
  fenceRun(ctx, west, along(west, south, 0.44), Math.round(cols * 0.88), 0, fenceRandom, 9);
  fenceRun(ctx, along(west, south, 0.56), south, Math.round(cols * 0.88), 0, fenceRandom, 9);
  fenceRun(ctx, south, east, rows * 2, 0, fenceRandom, 9);
  return glows;
}

// Owns one canvas: redraws the world on new state, animates the air above it.
export function createScene(canvas) {
  const world = document.createElement('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let layout = null;
  let glows = [];
  let hover = null;
  let selected = null;
  let last = 0;
  let flies = [];
  let floaters = [];
  let visitors = [];

  function drawOverlay(time) {
    const ctx = canvas.getContext('2d');
    ctx.drawImage(world, 0, 0);
    const mark = (plot, color) => {
      if (plot === null) return;
      const [cx, cy] = tileCenter(layout, plot % layout.cols, Math.floor(plot / layout.cols));
      outlineTile(ctx, cx, cy, color);
    };
    mark(hover, '#ffffff');
    mark(selected, '#f0c566');

    for (const [index, [x, y]] of glows.entries()) {
      const flicker = 0.14 + Math.sin(time / 310 + index * 2) * 0.03;
      ctx.fillStyle = `rgba(255, 196, 96, ${flicker})`;
      for (let dy = -14; dy <= 14; dy++) {
        const half = Math.round(Math.sqrt(196 - dy * dy) * 1.6);
        ctx.fillRect(Math.round(x - half), Math.round(y - 15 + dy), half * 2, 1);
      }
    }
    for (const { plot, item } of floaters) {
      const [cx, cy] = tileCenter(layout, plot % layout.cols, Math.floor(plot / layout.cols));
      drawFloating(ctx, cx + item.x, cy + item.y, item.type, time, plot + item.x);
    }
    BAND_SPOTS.forEach(([dc, dr, role], index) => {
      const [x, y] = tileCenter(layout, BAND_CENTER[0] + dc, BAND_CENTER[1] + dr);
      ctx.save();
      ctx.scale(2, 2);
      drawSkeleton(ctx, Math.round(x / 2), Math.round((y - STAGE_HEIGHT) / 2), time, role, index * 0.7);
      ctx.restore();
    });
    for (const visitor of [...visitors].sort((a, b) => a.c + a.r - b.c - b.r)) {
      const [x, y] = tileCenter(layout, visitor.c, visitor.r);
      drawChubrik(ctx, Math.round(x), Math.round(y), time, visitor);
    }
    for (let band = 0; band < 3; band++) {
      const y = layout.oy + (layout.cols + layout.rows) * STEP_Y * (0.25 + band * 0.27);
      const drift = ((time / (90 + band * 40)) % (layout.width + 240)) - 120;
      ctx.fillStyle = 'rgba(205, 212, 235, 0.05)';
      for (let i = 0; i < 4; i++) {
        const x = (drift + i * 230 + band * 90) % (layout.width + 240) - 120;
        ctx.fillRect(Math.round(x), Math.round(y), 170, 5);
        ctx.fillRect(Math.round(x + 22), Math.round(y - 3), 110, 3);
        ctx.fillRect(Math.round(x + 40), Math.round(y + 5), 90, 2);
      }
    }
    for (const fly of flies) {
      const x = fly.x + Math.sin(time / fly.speed + fly.phase) * 14;
      const y = fly.y + Math.cos(time / (fly.speed * 1.4) + fly.phase) * 7;
      if (Math.sin(time / 500 + fly.phase) > -0.2) rect(ctx, x, y, 1, 1, '#e8f58a');
    }
  }

  function frame(time) {
    requestAnimationFrame(frame);
    if (!layout || time - last < FRAME_MS) return;
    last = time;
    drawOverlay(time);
  }

  if (!reduced) requestAnimationFrame(frame);

  return {
    update(state, adLabel = 'AD') {
      const next = computeLayout(state.grid);
      if (!layout || next.width !== layout.width) {
        layout = next;
        canvas.width = world.width = layout.width;
        canvas.height = world.height = layout.height;
        const r = rng(5);
        flies = Array.from({ length: 22 }, () => ({
          x: layout.width * (0.12 + r() * 0.76),
          y: layout.oy + r() * (layout.cols + layout.rows) * STEP_Y,
          speed: 500 + r() * 900,
          phase: r() * 6.28,
        }));
      }
      glows = drawWorld(world.getContext('2d'), layout, state, adLabel);
      floaters = state.plots
        .filter((plot) => plot.grave && plot.grave.stage < 3)
        .flatMap((plot) => plot.grave.items.filter((item) => FLOATING.has(item.type)).map((item) => ({ plot: plot.plot, item })));
      drawOverlay(performance.now());
    },
    setHover(plot) {
      if (plot === hover) return;
      hover = plot;
      if (reduced && layout) drawOverlay(0);
    },
    setSelected(plot) {
      selected = plot;
      if (layout) drawOverlay(performance.now());
    },
    setVisitors(list) {
      visitors = list;
      if (reduced && layout) drawOverlay(0);
    },
    // Where a map position sits on the canvas, as a share of its size: the camera follows the walker with it.
    shareOf(col, row) {
      const [x, y] = tileCenter(layout, col, row);
      return [x / layout.width, y / layout.height];
    },
    plotAt(clientX, clientY) {
      if (!layout) return null;
      const bounds = canvas.getBoundingClientRect();
      return plotAtPoint(
        layout,
        ((clientX - bounds.left) / bounds.width) * layout.width,
        ((clientY - bounds.top) / bounds.height) * layout.height,
      );
    },
  };
}

export const CHUBRIK_COUNT = CHUBRIK_COLORS.length;
export const chubrikColor = (index) => CHUBRIK_COLORS[index % CHUBRIK_COLORS.length];

// The band on a big stage. It reports where each player stands, so speech bubbles can sit above them.
export const BAND_PLAYERS = [
  { role: 'guitar', x: 11, y: 54 },
  { role: 'drums', x: 31, y: 46 },
  { role: 'singer', x: 50, y: 58 },
  { role: 'bass', x: 68, y: 48 },
  { role: 'organ', x: 88, y: 55 },
];

export function createBandView(canvas) {
  const WIDTH = 120;
  const HEIGHT = 68;
  const SCALE = 8;
  const SPRITE = 2;
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = true;
  let last = 0;

  function paint(time) {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 0, 0, WIDTH, HEIGHT, '#141a33');
    for (let i = 0; i < 12; i++) rect(ctx, i * 10, 0, 5, 38, i % 2 ? '#5c1f33' : '#6f2740');
    rect(ctx, 0, 38, WIDTH, 30, '#6b4a2c');
    for (let i = 0; i < 6; i++) rect(ctx, 0, 42 + i * 5, WIDTH, 1, '#4d3420');
    rect(ctx, 0, 0, WIDTH, 3, '#f0c566');
    for (let i = 0; i < 6; i++) {
      const on = Math.floor(time / 400 + i) % 2;
      rect(ctx, 8 + i * 21, 3, 2, 2, on ? '#ffe27a' : '#8a6728');
    }
    ctx.setTransform(SCALE * SPRITE, 0, 0, SCALE * SPRITE, 0, 0);
    BAND_PLAYERS.forEach(({ role, x, y }, index) => {
      drawSkeleton(ctx, Math.round((x / 100) * WIDTH / SPRITE), Math.round((y / 100) * HEIGHT / SPRITE) + 8, time, role, index * 0.7);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function loop(time) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (time - last < FRAME_MS) return;
    last = time;
    paint(time);
  }
  paint(0);
  if (!reduced) requestAnimationFrame(loop);
  return { stop() { running = false; } };
}

function wrapLines(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Text lies on a stone face: slope follows the iso edge, so it looks carved rather than pasted on.
function carveText(ctx, [ox, oy], slope, width, height, title, body, color) {
  ctx.save();
  ctx.transform(1, slope, 0, 1, ox, oy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  const inner = width - 1;
  for (let size = 2.2; size >= 0.9; size -= 0.1) {
    ctx.font = `600 ${size}px Georgia, "Times New Roman", serif`;
    const lines = [...(title ? wrapLines(ctx, title, inner) : []), ...(body ? wrapLines(ctx, body, inner) : [])];
    const total = lines.length * size * 1.15;
    if (total <= height - 1 || size <= 1) {
      const top = (height - Math.min(total, height)) / 2;
      lines.forEach((line, index) => ctx.fillText(line, width / 2, top + index * size * 1.15, inner));
      break;
    }
  }
  ctx.restore();
}

// A large animated view of one grave: it turns and zooms, and its inscription stays readable.
export function createCloseup(canvas) {
  const WIDTH = 84;
  const HEIGHT = 76;
  const CENTER_X = 42;
  const CENTER_Y = 46;
  const SCALE = 10;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  const low = document.createElement('canvas');
  low.width = WIDTH;
  low.height = HEIGHT;
  const lowCtx = low.getContext('2d');
  let current = null;
  let running = true;
  let last = 0;
  let rot = 0;
  let zoom = 1;

  // Zoom aims at whatever carries the text: the stone itself, or the plaque at its foot.
  function zoomCenter() {
    const grave = current?.grave;
    if (grave?.style === 'slab' || !grave?.epitaph) return [CENTER_X, CENTER_Y - 12];
    const [px] = rotatePoint(...PLAQUE_SPOT, rot);
    return [CENTER_X + px * 0.6, CENTER_Y - 2];
  }

  function viewOrigin() {
    if (zoom === 1) return [0, 0];
    const [cx, cy] = zoomCenter();
    return [
      Math.min(WIDTH - WIDTH / zoom, Math.max(0, cx - WIDTH / (2 * zoom))),
      Math.min(HEIGHT - HEIGHT / zoom, Math.max(0, cy - HEIGHT / (2 * zoom))),
    ];
  }

  function paintInscription() {
    const grave = current?.grave;
    if (!grave || grave.stage === 3 || rot > 1) return;
    const name = grave.name ?? grave.ownName ?? '';
    const ink = grave.color === 'obsidian' && grave.style === 'slab' ? '#e7dcc0' : '#2a2433';
    if (grave.style === 'slab') {
      const origin = rot === 0 ? [CENTER_X - 9, CENTER_Y - 20.5] : [CENTER_X - 5, CENTER_Y - 13.5];
      carveText(ctx, origin, rot === 0 ? 0.5 : -0.5, 14, 15, name, grave.epitaph, ink);
    } else if (grave.epitaph) {
      const [px, py] = rotatePoint(...PLAQUE_SPOT, rot);
      const origin = rot === 0
        ? [CENTER_X + px - 6, CENTER_Y + py - 7]
        : [CENTER_X + px - 4, CENTER_Y + py - 2];
      carveText(ctx, origin, rot === 0 ? 0.5 : -0.5, 10, 5, '', grave.epitaph, ink);
    }
  }

  function paint(time) {
    if (!current) return;
    const gradient = lowCtx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, '#1a1f3c');
    gradient.addColorStop(1, '#3d3355');
    lowCtx.fillStyle = gradient;
    lowCtx.fillRect(0, 0, WIDTH, HEIGHT);
    lowCtx.fillStyle = '#d9dcc8';
    for (let y = -5; y <= 5; y++) {
      const half = Math.round(Math.sqrt(25 - y * y));
      lowCtx.fillRect(WIDTH - 14 - half, 12 + y, half * 2, 1);
    }
    lowCtx.fillStyle = '#1b1e38';
    for (let x = 0; x < WIDTH; x++) lowCtx.fillRect(x, Math.round(30 + Math.sin(x * 0.09) * 4), 1, HEIGHT);
    box(lowCtx, CENTER_X, CENTER_Y + 10, TILE_P + 0.5, TILE_P + 0.5, 10, 0, ['#2f4a3a', '#4a3527', '#35261c']);
    drawPlot(lowCtx, CENTER_X, CENTER_Y, current, rot, true);
    if (current.grave && current.grave.stage < 3) {
      for (const item of current.grave.items ?? []) {
        if (FLOATING.has(item.type)) {
          const [x, y] = rotatePoint(item.x, item.y, rot);
          drawFloating(lowCtx, CENTER_X + x, CENTER_Y + y, item.type, time, item.x);
        }
      }
    }
    const [sx, sy] = viewOrigin();
    const scale = SCALE * zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, sx, sy, WIDTH / zoom, HEIGHT / zoom, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -sx * scale, -sy * scale);
    paintInscription();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function loop(time) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (time - last < FRAME_MS * 2) return;
    last = time;
    paint(time);
  }
  if (!reduced) requestAnimationFrame(loop);

  return {
    set(plot) {
      current = plot;
      paint(performance.now());
    },
    stop() {
      running = false;
    },
    turn(direction) {
      rot = (rot + direction + 4) % 4;
      paint(performance.now());
    },
    toggleZoom() {
      zoom = zoom === 1 ? 2 : 1;
      paint(performance.now());
      return zoom;
    },
    // Screen point back to stored ground coordinates, whatever the current turn and zoom.
    toGround(clientX, clientY) {
      const bounds = canvas.getBoundingClientRect();
      const [sx, sy] = viewOrigin();
      const px = Math.round(sx + (((clientX - bounds.left) / bounds.width) * WIDTH) / zoom - CENTER_X);
      const py = Math.round(sy + (((clientY - bounds.top) / bounds.height) * HEIGHT) / zoom - CENTER_Y);
      const [x, y] = rotatePoint(px, py, (4 - rot) % 4);
      return { x, y, inside: Math.abs(x) / STEP_X + Math.abs(y) / STEP_Y <= 1 };
    },
  };
}

const HALL_THEMES = {
  marble: { wall: '#6d6880', floorA: '#8d8a9c', floorB: '#6f6c80', trim: '#f0c566', ink: '#ffe9a8' },
  obsidian: { wall: '#25222f', floorA: '#3a3648', floorB: '#292635', trim: '#b56cf0', ink: '#e6d4ff' },
  gold: { wall: '#6b5426', floorA: '#b58a38', floorB: '#8a6728', trim: '#ffe27a', ink: '#fff2bd' },
  rose: { wall: '#6a3c52', floorA: '#a9708a', floorB: '#85546c', trim: '#ffc2dc', ink: '#ffe4ef' },
  neon: { wall: '#12281f', floorA: '#1d4a38', floorB: '#163729', trim: '#7dffb0', ink: '#c9ffe0' },
  ice: { wall: '#2f4f66', floorA: '#6db6d9', floorB: '#4a87a6', trim: '#d6f4ff', ink: '#e8f9ff' },
  stone: { wall: '#4f4e5c', floorA: '#6d6e7c', floorB: '#585968', trim: '#d9d4e4', ink: '#f2efe6' },
};

// The inside of a crypt: a hall with a huge banner on the back wall and a stone floor to furnish.
export function createCryptHall(canvas) {
  const WIDTH = 160;
  const HEIGHT = 100;
  const FLOOR_Y = 50;
  const CENTER_X = 80;
  const SCALE = 6;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  const low = document.createElement('canvas');
  low.width = WIDTH;
  low.height = HEIGHT;
  const lowCtx = low.getContext('2d');
  let current = { title: '', body: '', color: 'marble', items: [] };
  let running = true;
  let last = 0;

  function paint(time) {
    const theme = HALL_THEMES[current.color] ?? HALL_THEMES.marble;
    const c = lowCtx;
    rect(c, 0, 0, WIDTH, FLOOR_Y, theme.wall);
    for (let y = 0; y < FLOOR_Y; y += 8) rect(c, 0, y, WIDTH, 1, 'rgba(0, 0, 0, 0.14)');
    for (let row = 0; row < 7; row++) {
      const y0 = FLOOR_Y + Math.round((row * row * 50) / 49);
      const y1 = FLOOR_Y + Math.round(((row + 1) * (row + 1) * 50) / 49);
      const size = 10 + row * 4;
      for (let i = -9; i <= 9; i++) {
        const even = (i + row + 20) % 2 === 0;
        rect(c, CENTER_X + i * size - size / 2, y0, size, Math.max(1, y1 - y0), even ? theme.floorA : theme.floorB);
      }
    }
    // Columns.
    for (const x of [8, 26, WIDTH - 34, WIDTH - 16]) {
      rect(c, x, 0, 10, FLOOR_Y + 4, '#c9c4d6');
      rect(c, x + 7, 0, 3, FLOOR_Y + 4, '#8f8aa0');
      rect(c, x - 2, FLOOR_Y + 2, 14, 3, '#a9a4b8');
      rect(c, x - 2, 0, 14, 3, '#a9a4b8');
    }
    // Banner frame; the text goes on top at full resolution.
    rect(c, 42, 4, 76, 36, theme.trim);
    rect(c, 44, 6, 72, 32, '#14131f');
    // Torches.
    for (const [index, x] of [38, 122].entries()) {
      rect(c, x - 1, 22, 2, 12, '#3a3030');
      const flame = Math.sin(time / 120 + index * 2) > 0 ? 1 : 0;
      rect(c, x - 2, 17 - flame, 4, 5 + flame, '#ff9a3c');
      rect(c, x - 1, 18, 2, 3, '#ffe27a');
      c.fillStyle = 'rgba(255, 180, 90, 0.08)';
      for (let dy = -11; dy <= 11; dy++) {
        const half = Math.round(Math.sqrt(121 - dy * dy));
        c.fillRect(x - half, 19 + dy, half * 2, 1);
      }
    }
    // Sarcophagus in the middle of the hall.
    box(c, CENTER_X, FLOOR_Y + 22, 6.5, 3, 2, 0, ['#a9a595', '#837f70', '#6a675a']);
    box(c, CENTER_X, FLOOR_Y + 22, 5.5, 2.5, 8, 2, ['#e7e3d6', '#c2bdac', '#9a9686']);
    box(c, CENTER_X, FLOOR_Y + 22, 6, 3, 2, 10, [theme.trim, '#8a6728', '#6a4e1e']);

    const items = [...current.items].sort((a, b) => a.y - b.y);
    for (const item of items) {
      const x = CENTER_X + item.x;
      const y = FLOOR_Y + item.y;
      if (FLOATING.has(item.type)) drawFloating(c, x, y, item.type, time, item.x);
      else drawItem(c, x, y, item.type, 0);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.ink;
    ctx.font = '700 6px Georgia, "Times New Roman", serif';
    ctx.fillText(current.title, 80, 9, 68);
    ctx.font = '400 3.6px Georgia, "Times New Roman", serif';
    wrapLines(ctx, current.body, 66).slice(0, 4).forEach((line, index) => ctx.fillText(line, 80, 18 + index * 4.6));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function loop(time) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (time - last < FRAME_MS * 2) return;
    last = time;
    paint(time);
  }
  if (!reduced) requestAnimationFrame(loop);

  return {
    set(next) {
      current = next;
      paint(performance.now());
    },
    stop() {
      running = false;
    },
    toFloor(clientX, clientY) {
      const bounds = canvas.getBoundingClientRect();
      const x = Math.round(((clientX - bounds.left) / bounds.width) * WIDTH - CENTER_X);
      const y = Math.round(((clientY - bounds.top) / bounds.height) * HEIGHT - FLOOR_Y);
      return { x, y, inside: Math.abs(x) <= 70 && y >= 2 && y <= 46 };
    },
  };
}