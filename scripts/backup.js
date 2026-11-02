// Makes a consistent copy of the database and keeps the last 14. Usage: node scripts/backup.js [folder]
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = 14;
const folder = process.argv[2] ?? 'backups';
mkdirSync(folder, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(folder, `riper-${stamp}.db`);
const db = new DatabaseSync('data/riper.db', { readOnly: true });
db.prepare('VACUUM INTO ?').run(target);
db.close();

const old = readdirSync(folder).filter((name) => /^riper-.*\.db$/.test(name)).sort().slice(0, -KEEP);
for (const name of old) rmSync(join(folder, name));
console.log(`Backup: ${target}`);
