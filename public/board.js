import { t } from './i18n.js';

function list(title, rows) {
  const section = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = title;
  const items = document.createElement('ol');
  for (const row of rows) {
    const item = document.createElement('li');
    item.textContent = row;
    items.append(item);
  }
  section.append(heading, items);
  return section;
}

const entryText = (entry) => (entry.kind === 'note' ? entry.text : t(`entry_${entry.kind}`, entry));

// The notice board's contents, shared by the site and the stream. Everything is set as text, never as HTML.
export function renderBoard(node, data, limit = 8) {
  const parts = [];
  if (data.entries.length) parts.push(list(t('boardLatest'), data.entries.slice(0, limit).map(entryText)));
  if (data.ghosts.length) parts.push(list(t('boardGhostsTitle'), data.ghosts.map((row) => `${row.nick}: ${row.count}`)));
  if (data.duels.length) parts.push(list(t('boardDuelsTitle'), data.duels.map((row) => `${row.nick}: ${row.count}`)));
  if (data.record) parts.push(list(t('boardRecordTitle'), [t('boardRecord', { nick: data.record.nick, minutes: Math.round(data.record.ms / 60_000) })]));
  if (!parts.length) {
    const empty = document.createElement('p');
    empty.textContent = t('boardEmpty');
    parts.push(empty);
  }
  node.replaceChildren(...parts);
}
