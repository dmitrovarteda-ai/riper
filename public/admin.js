const $ = (id) => document.getElementById(id);
let token = '';
try {
  token = sessionStorage.getItem('adminToken') ?? '';
} catch {}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'server_error');
  return data;
}

function button(label, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', async () => {
    try {
      await onClick();
      await load();
    } catch (err) {
      $('error').textContent = err.message;
    }
  });
  return node;
}

function input(placeholder, value = '', maxLength = 40) {
  return Object.assign(document.createElement('input'), { placeholder, value, maxLength });
}

let lastGift = null;

function formatCode(code) {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

function giftNotice() {
  const box = document.createElement('section');
  if (!lastGift) return box;
  box.className = 'gift-code';
  const title = document.createElement('h2');
  title.textContent = `Код для «${lastGift.name}»`;
  const code = Object.assign(document.createElement('p'), { className: 'code', textContent: formatCode(lastGift.code) });
  const note = Object.assign(document.createElement('p'), { className: 'small', textContent: 'Передайте его владельцу: код показывается один раз. Вход на главной странице, поле с кодом.' });
  box.append(title, code, note);
  return box;
}

function backupSection() {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = 'Сезон кладбища';
  const note = Object.assign(document.createElement('p'), {
    className: 'small',
    textContent: 'На бесплатном хостинге после перезапуска всё сбрасывается. В конце стрима нажимайте «Сохранить сезон»: в файл попадут могилы, доска, очки и рекорды. Перед следующим стримом загрузите его обратно.',
  });
  const file = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  row.append(button('Сохранить сезон', async () => {
    const copy = await api('/api/admin/export');
    const link = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(copy)], { type: 'application/json' })),
      download: `riper-season-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`,
    });
    link.click();
    URL.revokeObjectURL(link.href);
  }), file, button('Загрузить сезон', async () => {
    if (!file.files[0]) throw new Error('Сначала выберите файл сезона');
    if (confirm('Заменить всё кладбище, доску и очки содержимым этого файла?')) await api('/api/admin/import', JSON.parse(await file.files[0].text()));
  }));
  section.append(title, note, row);
  return section;
}

function cryptSection(crypts) {
  return table('Склепы', ['Склеп', 'Кому', ''], crypts.map((crypt) => {
    if (crypt.name) {
      return [crypt.id, crypt.name, [button('Забрать склеп', async () => {
        if (confirm(`Забрать склеп у «${crypt.name}»? Его оформление удалится.`)) await api('/api/admin/revoke-crypt', { zone: crypt.id });
      })]];
    }
    const name = input('Имя на вывеске', '', 24);
    return [crypt.id, [name], [button('Подарить', async () => {
      const { code } = await api('/api/admin/gift-crypt', { zone: crypt.id, name: name.value });
      lastGift = { name: name.value, code };
    })]];
  }));
}

function createSection() {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = 'Новая могила';
  const plot = input('Номер места', '', 4);
  const name = input('Имя на могиле', '', 24);
  const epitaph = input('Надпись, можно пусто', '', 40);
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  row.append(plot, name, epitaph, button('Создать', async () => {
    const created = await api('/api/admin/grave-create', { plot: Number(plot.value) - 1, name: name.value, epitaph: epitaph.value });
    lastGift = { name: name.value, code: created.code };
  }));
  section.append(title, row);
  return section;
}

function onlineSection(online) {
  return table('Сейчас на кладбище', ['Ник', ''], online.map((visitor) => [
    visitor.nick,
    [visitor.locked ? 'ник сброшен' : button('Сбросить ник', () => api('/api/admin/reset-nick', { id: visitor.id }))],
  ]));
}

function boardSection(board) {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = 'Доска объявлений';
  const text = input('Ваше объявление, до 120 символов', '', 120);
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  row.append(text, button('Опубликовать', () => api('/api/admin/board-note', { text: text.value })));
  section.append(title, row);
  const describe = (entry) => (entry.kind === 'note' ? entry.text : entry.kind === 'ghost' ? `${entry.nick} поймал(а) призрака` : entry.kind === 'duel' ? `${entry.nick} победил(а) ${entry.other}` : `${entry.nick}: рекорд ${entry.minutes} мин`);
  section.append(table('Записи', ['Запись', ''], board.entries.map((entry) => [describe(entry), [button('Убрать', () => api('/api/admin/board-remove', { at: entry.at }))]])));
  return section;
}

function streamSection(spotlight, streamOnline, autoshow) {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = 'Эфир';
  const link = Object.assign(document.createElement('p'), {
    className: streamOnline ? 'small' : 'error',
    textContent: streamOnline
      ? 'Страница эфира на связи.'
      : 'Страница эфира не на связи: кнопки не подействуют. Обновите источник «Браузер» в OBS (Свойства → Обновить кэш текущей страницы).',
  });
  const note = Object.assign(document.createElement('p'), {
    className: 'small',
    textContent: spotlight === 'band'
      ? 'Сейчас в эфире вручную: группа.'
      : spotlight === 'board'
        ? 'Сейчас в эфире вручную: доска объявлений.'
        : spotlight === 'follow'
          ? 'Сейчас в эфире вручную: камера следит за игроком.'
          : spotlight !== null
            ? `Сейчас в эфире вручную: место №${spotlight + 1}.`
            : autoshow
              ? 'Идёт автопоказ: могила 30 с, кладбище 1 мин, группа 30 с, кладбище 1 мин, следующая могила. Вторую половину минуты камера следит за игроком, а когда есть события, 20 с показывается доска.'
              : 'Автопоказ выключен, в эфире кладбище. Могила или группа появятся только по вашей кнопке.',
  });
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  const manual = (label, value) => button(spotlight === value ? `Убрать: ${label}` : `Показать: ${label}`, () => api('/api/admin/spotlight', { plot: spotlight === value ? null : value }));
  row.append(
    button(autoshow ? 'Автопоказ: выключить' : 'Автопоказ: включить', () => api('/api/admin/autoshow', { on: !autoshow })),
    manual('группа', 'band'),
    manual('камера за игроком', 'follow'),
    manual('доска', 'board'),
  );
  if (spotlight !== null) row.append(button('Снять ручной показ', () => api('/api/admin/spotlight', { plot: null })));
  section.append(title, link, note, row);
  return section;
}

function graveSection(graves, spotlight) {
  return table('Все могилы и склепы', ['Место', 'Имя', 'Надпись', 'Состояние', ''], graves.map((grave) => {
    const name = input('Имя', grave.name, 24);
    const epitaph = input('Надпись', grave.epitaph ?? '', 40);
    const crypt = grave.tier === 5;
    const stage = document.createElement('select');
    ['Ухоженная', 'Неопрятная', 'Запущенная', 'Заброшенная'].forEach((label, value) => stage.append(new Option(label, String(value))));
    stage.value = String(grave.demo_stage ?? 0);
    stage.disabled = crypt;
    return [
      grave.plot + 1,
      [name],
      [epitaph],
      [stage],
      [
        crypt ? '' : button(spotlight === grave.plot ? 'В эфире: убрать' : 'Показать в эфире', () => api('/api/admin/spotlight', { plot: spotlight === grave.plot ? null : grave.plot })),
        button('Сохранить', () => api('/api/admin/grave-update', { plot: grave.plot, name: name.value, epitaph: epitaph.value, ...(crypt ? {} : { stage: Number(stage.value) }) })),
        button('Редактор', async () => {
          const { code } = await api('/api/admin/editor-code', { plot: grave.plot });
          window.open(`/?edit=${code}`, '_blank', 'noopener');
        }),
        button('Удалить', async () => {
          if (confirm(`Удалить «${grave.name}»? Вернуть нельзя.`)) await api('/api/admin/grave-remove', { plot: grave.plot });
        }),
      ],
    ];
  }));
}

function table(title, headers, rows) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = `${title} (${rows.length})`;
  section.append(h2);
  if (!rows.length) return section;
  const tbl = document.createElement('table');
  const head = tbl.insertRow();
  for (const text of headers) head.append(Object.assign(document.createElement('th'), { textContent: text }));
  for (const cells of rows) {
    const row = tbl.insertRow();
    for (const cell of cells) {
      const td = row.insertCell();
      td.append(...(Array.isArray(cell) ? cell : [String(cell ?? '')]));
    }
  }
  section.append(tbl);
  return section;
}

async function load() {
  const queue = await api('/api/admin/queue');
  const { spotlight, streamOnline, autoshow } = await api('/api/live');
  const online = await api('/api/admin/online');
  const board = await api('/api/board');
  $('auth').hidden = true;
  $('error').textContent = '';
  $('queue').replaceChildren(
    giftNotice(),
    streamSection(spotlight, streamOnline, autoshow),
    backupSection(),
    boardSection(board),
    onlineSection(online),
    cryptSection(queue.crypts),
    createSection(),
    graveSection(queue.allGraves, spotlight),
    table('Имена на проверке', ['Место', 'Имя', ''], queue.graves.map((grave) => [
      grave.plot + 1,
      grave.name,
      [
        button('Одобрить', () => api('/api/admin/review', { plot: grave.plot, decision: 'approved' })),
        button('Отклонить', () => api('/api/admin/review', { plot: grave.plot, decision: 'rejected' })),
      ],
    ])),
    table('Надписи и ссылки на проверке', ['Место', 'Имя', 'Текст', 'Ссылка', ''], queue.epitaphs.map((item) => [
      item.plot + 1,
      item.name,
      item.epitaph_pending,
      item.link_pending,
      [
        button('Одобрить', () => api('/api/admin/epitaph', { plot: item.plot, approve: true })),
        button('Отклонить', () => api('/api/admin/epitaph', { plot: item.plot, approve: false })),
      ],
    ])),
    table('Подписчики: сверяйте с Boosty раз в месяц', ['Срок', 'Имя на Boosty', 'Уровень', 'Место', 'Имя', ''], queue.subscribers.map((sub) => [
      `${new Date(sub.paid_until).toLocaleDateString()}${sub.paid_until < Date.now() ? ' (истекла)' : ''}`,
      sub.buyer_ref,
      sub.tier,
      sub.plot + 1,
      sub.name,
      [button('Подписка есть: +1 месяц', () => api('/api/admin/renew', { plot: sub.plot }))],
    ])),
    table('Жалобы', ['Место', 'Имя', 'Причина', ''], queue.reports.map((report) => [
      report.plot + 1,
      report.name,
      report.reason,
      [
        button('Скрыть могилу', () => api('/api/admin/report', { id: report.id, hide: true })),
        button('Оставить', () => api('/api/admin/report', { id: report.id, hide: false })),
      ],
    ])),
    table('Платежи без выдачи: привязать к заказу или вернуть деньги в Stripe', ['Почта', 'Товар', 'Сумма', 'Заказ'], queue.payments.map((payment) => [
      payment.email,
      payment.product ?? 'заказ не найден',
      `${(payment.amount ?? 0) / 100} ${payment.currency ?? ''}`,
      queue.orders.filter((order) => order.product === payment.product).map((order) => button(
        `место ${order.plot + 1}: ${order.name ?? order.product}`,
        () => api('/api/admin/attach', { paymentId: payment.id, token: order.token }),
      )),
    ])),
    table('Заказы: проверьте платёж на Boosty', ['Номер', 'Имя на Boosty', 'Товар', 'Место', 'Имя на могиле', ''], queue.orders.map((order) => [
      order.number,
      order.buyer_ref,
      order.product,
      order.plot + 1,
      order.name,
      [button('Оплата есть: выдать', () => api('/api/admin/confirm', { token: order.token }))],
    ])),
  );
}

$('auth').addEventListener('submit', async (event) => {
  event.preventDefault();
  token = $('token').value;
  try {
    await load();
    try {
      sessionStorage.setItem('adminToken', token);
    } catch {}
  } catch (err) {
    $('error').textContent = err.message;
  }
});

if (token) load().catch(() => { token = ''; });
// Refreshing must not wipe what the owner is typing in a form.
setInterval(() => {
  const typing = ['INPUT', 'SELECT'].includes(document.activeElement?.tagName);
  if (token && $('auth').hidden && !typing) load().catch(() => {});
}, 15_000);
