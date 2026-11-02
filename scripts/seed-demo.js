// Fills the beta cemetery with joke graves. Safe to run again: existing demo graves are updated.
import { mkdirSync } from 'node:fs';
import { createCore } from '../src/core.js';

const at = (col, row) => row * 15 + col;

export const DEMO_GRAVES = [
  {
    plot: at(7, 3), name: 'Мой дедлайн', epitaph: 'Был вчера', style: 'slab', color: 'obsidian', fence: true, stage: 0,
    items: [{ type: 'candle', x: -16, y: 8 }, { type: 'candle', x: 16, y: 8 }, { type: 'skull', x: 2, y: 12 }],
  },
  {
    plot: at(5, 2), name: 'Мой Wi-Fi', epitaph: 'Пропал, когда был нужен', style: 'cross', color: 'ice', fence: false, stage: 0,
    items: [{ type: 'ghost', x: 16, y: -2 }, { type: 'pebble', x: -14, y: 6 }],
  },
  {
    plot: at(9, 3), name: 'Планы на понедельник', epitaph: 'Всегда со следующего', style: 'obelisk', color: 'gold', fence: true, stage: 0,
    items: [{ type: 'crown', x: 12, y: 8 }, { type: 'rose', x: -14, y: 8 }, { type: 'tulip', x: -8, y: 11 }, { type: 'violet', x: 2, y: 13 }],
  },
  {
    plot: at(3, 4), name: 'Мой спортзал', epitaph: 'Абонемент оплачен', style: 'slab', color: 'stone', fence: true, stage: 3,
    items: [{ type: 'pebble', x: 15, y: 6 }],
  },
  {
    plot: at(6, 5), name: 'Последний сэйв', epitaph: 'Забыл сохраниться', style: 'cross', color: 'rose', fence: false, stage: 1,
    items: [{ type: 'pumpkin', x: 15, y: 5 }, { type: 'raven', x: -16, y: 2 }],
  },
  {
    plot: at(10, 5), name: 'Носок из стиралки', epitaph: 'Ушёл и не вернулся', style: 'slab', color: 'marble', fence: false, stage: 0,
    items: [{ type: 'ufo', x: 0, y: -4 }, { type: 'tulip', x: -14, y: 8 }, { type: 'rose', x: 14, y: 8 }],
  },
  {
    plot: at(11, 3), name: 'Мои нервы', epitaph: 'Сдали первыми', style: 'obelisk', color: 'neon', fence: true, stage: 2,
    items: [{ type: 'disco', x: -18, y: 2 }, { type: 'bat', x: 15, y: -3 }, { type: 'coffin', x: 8, y: 10 }],
  },
];

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/seed-demo.js')) {
  mkdirSync('data', { recursive: true });
  const core = createCore({ dbPath: process.env.DB_PATH || 'data/riper.db' });
  core.seedDemo(DEMO_GRAVES);
  core.close();
  console.log(`Demo graves ready: ${DEMO_GRAVES.length}`);
}
