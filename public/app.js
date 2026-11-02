import { createScene } from './render.js';
import { createGraveDialog } from './grave.js';
import { t, errorText, getLang, setLang } from './i18n.js';
import { createMusic } from './music.js';
import { createBandDialog, randomJoke } from './band.js';
import { createWalker } from './walk.js';

const $ = (id) => document.getElementById(id);
const panel = $('panel');
const canvas = $('map');
const scene = createScene(canvas);

let state = null;
let config = null;
let selected = null;
let view = 'empty';
let orderTimer = null;

const TIERS = [1, 2, 3, 4];
const CENTER_MIN_TIER = 3;

async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? 'server_error');
    err.code = data.error;
    throw err;
  }
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'on') for (const [name, fn] of Object.entries(value)) node.addEventListener(name, fn);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function clear(node, ...children) {
  node.replaceChildren(...children.filter((c) => c != null));
}

const graveDialog = createGraveDialog({
  api,
  el,
  clear,
  startPayment: (order) => startPayment(order),
  getConfig: () => config,
  getState: () => state,
  onClose: () => {
    if (view === 'grave') view = 'empty';
  },
});

const MUSIC_KEY = 'riperMusic';
const music = createMusic();
let musicWanted = true;
try {
  musicWanted = localStorage.getItem(MUSIC_KEY) !== 'off';
} catch {}

function renderMusicLabels() {
  const label = music.playing ? t('musicOn') : t('musicOff');
  $('music').textContent = label;
  $('band-music').textContent = label;
}

function toggleMusic() {
  if (music.playing) music.stop();
  else music.start();
  musicWanted = music.playing;
  try {
    localStorage.setItem(MUSIC_KEY, musicWanted ? 'on' : 'off');
  } catch {}
  renderMusicLabels();
}

$('music').addEventListener('click', toggleMusic);

// Browsers only allow sound after the first action on the page.
function startMusicOnce(event) {
  window.removeEventListener('pointerdown', startMusicOnce);
  window.removeEventListener('keydown', startMusicOnce);
  if (event.target?.closest?.('#music, #band-music')) return;
  if (musicWanted && !music.playing) music.start();
  renderMusicLabels();
}
window.addEventListener('pointerdown', startMusicOnce);
window.addEventListener('keydown', startMusicOnce);

const bandDialog = createBandDialog({ music, renderMusicButton: toggleMusic });

function staticText() {
  document.documentElement.lang = getLang();
  document.title = t('title');
  $('tagline').textContent = t('tagline');
  $('map-hint').textContent = t('mapHint');
  $('have-code').textContent = t('haveCode');
  $('enter').textContent = t('enter');
  $('code').placeholder = t('codePlaceholder');
  $('lang').textContent = getLang() === 'ru' ? 'English' : 'Русский';
  $('terms-link').textContent = t('terms');
  $('privacy-link').textContent = t('privacy');
  panel.dataset.empty = t('panelHint');
  renderMusicLabels();
  renderWalkLabels();
  $('how-title').textContent = t('howTitle');
  clear($('how-steps'), ...[1, 2, 3].map((step) => el('div', { className: 'how-step' },
    el('h3', { textContent: t(`how${step}Title`) }),
    el('p', { textContent: t(`how${step}Text`) }))));
  $('levels-title').textContent = t('levelsTitle');
  if (config) {
    const beta = !config.ordersOpen;
    $('beta-banner').hidden = !beta;
    $('beta-banner').textContent = t('betaBanner');

    $('tagline').textContent = beta ? t('betaTagline') : t('tagline');
    $('map-hint').textContent = beta ? t('betaHint') : t('mapHint');
    $('how-section').hidden = beta;
    $('levels-title').textContent = beta ? t('betaLevelsTitle') : t('levelsTitle');
    panel.dataset.empty = beta ? t('betaPanelHint') : t('panelHint');
    clear($('level-cards'), ...[...TIERS, 5].map((tier) => el('div', { className: tier === 5 ? 'level-card best' : 'level-card' },
      el('h3', { textContent: t(`tier${tier}`) }),
      el('p', { className: 'level-price', textContent: !config.ordersOpen || (tier === 5 && !config.cryptsOpen) ? t('cryptBetaPrice') : t('tierPrice', { price: config.products[`tier_${tier}`].price }) }),
      el('p', { className: 'small', textContent: t(`levelIncludes${tier}`) }))));
    for (const id of ['donate-top', 'donate-link']) {
      $(id).hidden = !config.donateUrl;
      $(id).textContent = t('donate');
      if (config.donateUrl) $(id).href = config.donateUrl;
    }
    $('donate-band').hidden = !config.donateUrl;
    $('donate-title').textContent = t('donateTitle');
    $('donate-note').textContent = t('donateNote');
  }
  renderFreeCount();
}

function renderFreeCount() {
  if (!state) return;
  const graves = state.plots.filter((plot) => !plot.ad && !plot.feature);
  const free = graves.filter((plot) => !plot.taken).length;
  $('free-count').textContent = config && !config.ordersOpen
    ? t('betaCount', { taken: graves.length - free })
    : t('freeCount', { free, total: graves.length });
}

function renderTicker() {
  clear($('ticker'), ...(state?.recent ?? []).slice(0, 5).map((event) => el('li', { textContent: t(`event_${event.type}`, { name: event.name }) })));
}

async function refresh() {
  state = await api('/api/state');
  scene.update(state, config?.cryptsOpen ? t('adLabel') : t('adLabelBeta'));
  renderTicker();
  renderFreeCount();
  // Live updates must not wipe what the viewer is typing.
  if (view === 'plot' && (state.plots[selected].taken || !panel.querySelector('form'))) showPlot(selected);
  graveDialog.refresh();
}


function tierPicker(minTier) {
  const options = TIERS.filter((tier) => tier >= minTier).map((tier) => el('label', { className: 'check' },
    el('input', { type: 'radio', name: 'tier', value: String(tier), checked: tier === minTier }),
    el('span', { textContent: `${t(`tier${tier}`)} · ${t('tierPrice', { price: config.products[`tier_${tier}`].price })}` })));
  return el('fieldset', { className: 'tiers' }, el('legend', { textContent: t('tierLabel') }), ...options);
}

function showPlot(index) {
  view = 'plot';
  selected = index;
  scene.setSelected(index);
  const plot = state.plots[index];
  const n = index + 1;
  if (plot.ad) {
    clear(panel);
    graveDialog.showCrypt(plot.ad);
    return;
  }
  if (plot.feature) {
    showFeature(plot.feature);
    return;
  }
  if (plot.grave) {
    clear(panel);
    graveDialog.showViewer(index);
    return;
  }
  if (plot.taken) {
    clear(panel, el('h2', { textContent: plot.occupied ? t('plotPending') : t('plotTaken') }));
    return;
  }
  if (!config.ordersOpen) {
    clear(panel, el('h2', { textContent: t('betaPlotTitle') }), el('p', { textContent: t('betaPlotText') }));
    return;
  }
  showOrderForm(plot, n);
}

function showFeature(feature) {
  view = 'feature';
  if (feature === 'stage') {
    clear(panel);
    bandDialog.open();
  } else if (feature === 'shop') {
    clear(panel,
      el('h2', { textContent: t('shopTip') }),
      el('p', { textContent: config.ordersOpen ? t('shopOpen') : t('shopBeta') }),
      config.donateUrl && !config.ordersOpen ? el('a', { className: 'button donate', href: config.donateUrl, target: '_blank', rel: 'noopener', textContent: t('donate') }) : null);
  } else if (feature === 'well') {
    const joke = el('p', { className: 'epitaph', textContent: randomJoke() });
    clear(panel,
      el('h2', { textContent: t('wellTip') }),
      joke,
      el('button', { type: 'button', className: 'ghost', textContent: t('wellMore'), on: { click: () => { joke.textContent = randomJoke(); } } }));
  } else {
    clear(panel, el('h2', { textContent: t('pathTip') }), el('p', { textContent: t('pathText') }));
  }
}

function showOrderForm(plot, n) {
  const error = el('p', { className: 'error', role: 'alert' });
  const name = el('input', { id: 'name', maxLength: 24, required: true, autocomplete: 'off' });
  const buyer = config.manualPayments ? el('input', { id: 'buyer', maxLength: 60, required: true, autocomplete: 'off' }) : null;
  const consent = el('input', { id: 'consent', type: 'checkbox' });
  const minTier = plot.center ? CENTER_MIN_TIER : 1;
  const picker = tierPicker(minTier);
  const chosenTier = () => Number(picker.querySelector('input:checked').value);
  const note = el('p', { className: 'small' });
  const showPrice = () => { note.textContent = t('priceNote', { price: config.products[`tier_${chosenTier()}`].price }); };
  picker.addEventListener('change', showPrice);
  showPrice();
  const form = el('form', {
    on: {
      submit: async (event) => {
        event.preventDefault();
        error.textContent = '';
        try {
          const order = await api('/api/orders/grave', { plot: plot.plot, name: name.value, consent: consent.checked, buyerRef: buyer?.value, tier: chosenTier() });
          startPayment(order);
        } catch (err) {
          error.textContent = errorText(err.code);
        }
      },
    },
  },
    el('div', { className: 'field' }, el('label', { htmlFor: 'name', textContent: t('nameLabel') }), name),
    buyer ? el('div', { className: 'field' }, el('label', { htmlFor: 'buyer', textContent: t('buyerLabel') }), buyer) : null,
    el('label', { className: 'check' }, consent, el('span', { textContent: t('consent') })),
    picker,
    note,
    el('p', { className: 'small' }, `${t('acceptTerms')} `, el('a', { href: '/terms', target: '_blank', textContent: t('terms') }), ` ${t('and')} `, el('a', { href: '/privacy', target: '_blank', textContent: t('privacy') }), '.'),
    error,
    el('button', { type: 'submit', textContent: t('support') }));
  clear(panel,
    el('h2', { textContent: t('plotFree', { n }) }),
    el('p', { className: 'small', textContent: plot.center ? `${t('plotCenter')}. ${t('centerNote')}` : t('plotEdge') }),
    form);
}

function startPayment(order) {
  if (order.manual) {
    showManualPayment(order);
    refresh();
    return;
  }
  if (order.checkoutUrl) {
    location.assign(order.checkoutUrl);
    return;
  }
  showPayment(order);
  refresh();
}

function showManualPayment(order) {
  view = 'payment';
  clearInterval(orderTimer);
  history.replaceState(null, '', `?order=${order.token}`);
  clear(panel,
    el('h2', { textContent: t('manualTitle', { number: order.number }) }),
    el('p', { textContent: t('manualStep1', { price: order.price, tier: t(`tier${order.tier}`) }) }),
    order.paymentUrl
      ? el('p', {}, el('a', { className: 'button', href: order.paymentUrl, target: '_blank', rel: 'noopener', textContent: t('manualOpen') }))
      : el('p', { className: 'small', textContent: t('payMissing') }),
    el('p', { textContent: t('manualStep2', { number: order.number }) }),
    el('p', { className: 'code', textContent: order.number }),
    el('p', { className: 'small', textContent: t('manualStep3') }),
    el('p', { className: 'small', textContent: t('manualKeep') }),
    el('p', { className: 'small', textContent: t('payWaiting') }));
  orderTimer = setInterval(() => pollOrder(order.token, false).catch(() => {}), 10_000);
}

function showPayment(order) {
  view = 'payment';
  clearInterval(orderTimer);
  const status = el('p', { className: 'small', textContent: t('payWaiting') });
  const error = el('p', { className: 'error', role: 'alert' });
  const actions = el('div', { className: 'actions' });
  if (!order.fromCheckout) actions.append(el('p', { className: 'small', textContent: t('payMissing') }));
  if (config.devPayments && !order.fromCheckout) {
    actions.append(el('button', {
      type: 'button',
      className: 'ghost',
      textContent: t('payDev'),
      on: {
        click: async () => {
          try {
            await api(`/api/orders/${order.token}/dev-pay`, {});
            await pollOrder(order.token);
          } catch (err) {
            error.textContent = errorText(err.code);
          }
        },
      },
    }));
  }
  clear(panel,
    el('h2', { textContent: t('payTitle') }),
    order.fromCheckout ? el('p', { textContent: t('payStep') }) : null,
    actions, status, error,
    el('p', { className: 'small', textContent: t('payProblem') }));
  orderTimer = setInterval(() => pollOrder(order.token, order.fromCheckout).catch(() => {}), 4000);
  if (order.fromCheckout) pollOrder(order.token, true).catch(() => {});
}

async function pollOrder(token, fromCheckout) {
  const order = fromCheckout ? await api(`/api/orders/${token}/sync`, {}) : await api(`/api/orders/${token}`);
  if (order.status !== 'paid') return;
  clearInterval(orderTimer);
  if (order.code) showPaid(order);
  else clear(panel, el('h2', { textContent: t('paidUpgrade') }));
  refresh();
}

function showPaid(order) {
  view = 'paid';
  const pretty = `${order.code.slice(0, 5)}-${order.code.slice(5)}`;
  clear(panel,
    el('h2', { textContent: t('paid') }),
    el('p', { className: 'code', textContent: pretty }),
    el('p', { textContent: t('paidNote') }),
    el('button', { type: 'button', textContent: t('toGrave'), on: { click: () => login(order.code) } }));
}

async function login(code) {
  try {
    const grave = await graveDialog.login(code);
    selected = grave.plot;
    scene.setSelected(grave.plot);
    view = 'grave';
    clear(panel);
    $('code').value = '';
    $('login-error').textContent = '';
  } catch (err) {
    $('login-error').textContent = errorText(err.code);
  }
}

// The map is wider than the page on purpose: graves stay large, and you move around by dragging.
const MAP_ZOOMS = [1, 1.25, 1.5, 2];
const mapWrap = canvas.parentElement;
let mapZoom = 1;
let mapDrag = null;
let mapDragged = false;

function applyMapZoom(level, center) {
  const before = center ? [(mapWrap.scrollLeft + mapWrap.clientWidth / 2) / canvas.offsetWidth, (mapWrap.scrollTop + mapWrap.clientHeight / 2) / canvas.offsetHeight] : [0.5, 0.5];
  mapZoom = level;
  canvas.style.width = `${canvas.width * level}px`;
  mapWrap.scrollLeft = before[0] * canvas.offsetWidth - mapWrap.clientWidth / 2;
  mapWrap.scrollTop = before[1] * canvas.offsetHeight - mapWrap.clientHeight / 2;
}

$('map-in').addEventListener('click', () => applyMapZoom(MAP_ZOOMS[Math.min(MAP_ZOOMS.length - 1, MAP_ZOOMS.indexOf(mapZoom) + 1)], true));
$('map-out').addEventListener('click', () => applyMapZoom(MAP_ZOOMS[Math.max(0, MAP_ZOOMS.indexOf(mapZoom) - 1)], true));

canvas.addEventListener('pointerdown', (event) => {
  mapDragged = false;
  if (event.pointerType === 'mouse') mapDrag = { x: event.clientX, y: event.clientY, left: mapWrap.scrollLeft, top: mapWrap.scrollTop };
});
window.addEventListener('pointermove', (event) => {
  if (!mapDrag) return;
  const dx = event.clientX - mapDrag.x;
  const dy = event.clientY - mapDrag.y;
  if (Math.hypot(dx, dy) > 5) mapDragged = true;
  mapWrap.scrollLeft = mapDrag.left - dx;
  mapWrap.scrollTop = mapDrag.top - dy;
});
window.addEventListener('pointerup', () => { mapDrag = null; });

canvas.addEventListener('click', (event) => {
  if (!state || mapDragged) return;
  const index = scene.plotAt(event.clientX, event.clientY);
  if (index !== null) showPlot(index);
});

function tipFor(index) {
  const plot = state?.plots[index];
  if (!plot) return null;
  const number = t('plotNumber', { n: index + 1 });
  if (plot.feature) return { title: t(`${plot.feature}Tip`) };
  if (plot.ad) {
    const { row, col } = state.ads.find((item) => item.id === plot.ad);
    const owner = state.plots[row * state.grid.cols + col].grave?.name;
    return { title: owner ?? t('cryptHeading'), note: t('plotNumber', { n: row * state.grid.cols + col + 1 }) };
  }
  if (plot.grave) return { title: plot.grave.name, note: number };
  return plot.taken ? { title: t('plotTaken'), note: number } : { title: t('freeTip', { n: index + 1 }) };
}

const mapTip = $('map-tip');
canvas.addEventListener('pointermove', (event) => {
  const index = scene.plotAt(event.clientX, event.clientY);
  scene.setHover(index);
  canvas.style.cursor = index === null ? 'default' : 'pointer';
  const tip = index === null ? null : tipFor(index);
  mapTip.hidden = !tip || event.pointerType !== 'mouse';
  if (mapTip.hidden) return;
  clear(mapTip, tip.title, tip.note ? el('small', { textContent: ` ${tip.note}` }) : null);
  mapTip.style.left = `${event.clientX}px`;
  mapTip.style.top = `${event.clientY}px`;
});
canvas.addEventListener('pointerleave', () => {
  scene.setHover(null);
  mapTip.hidden = true;
});

const walker = createWalker({
  scene,
  api,
  getState: () => state,
  onNear: renderNear,
  onMove: (col, row) => {
    const [x, y] = scene.shareOf(col, row);
    mapWrap.scrollLeft = x * canvas.offsetWidth - mapWrap.clientWidth / 2;
    mapWrap.scrollTop = y * canvas.offsetHeight - mapWrap.clientHeight / 2;
  },
});

function renderNear(index) {
  const near = $('near');
  const plot = index === null ? null : state.plots[index];
  near.hidden = !plot;
  if (!plot) return;
  const tip = tipFor(index);
  clear(near,
    el('h3', { textContent: tip.note ? `${tip.title} · ${tip.note}` : tip.title }),
    plot.grave?.epitaph ? el('p', { textContent: `« ${plot.grave.epitaph} »` }) : null,
    el('button', { type: 'button', textContent: t('walkOpen'), on: { click: () => showPlot(index) } }));
}

function renderWalkLabels() {
  $('walk').textContent = walker.walking ? t('walkStop') : t('walkStart');
  $('walk-hint').textContent = t('walkHint');
  $('walk-hint').hidden = !walker.walking;
  $('walk-pad').hidden = !walker.walking;
}

$('walk').addEventListener('click', () => {
  walker.setWalking(!walker.walking);
  $('walk').blur();
  renderWalkLabels();
});

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'e' && event.key.toLowerCase() !== 'у') return;
  if (!walker.walking || walker.isTyping(event) || walker.nearPlot === null) return;
  showPlot(walker.nearPlot);
});

for (const button of document.querySelectorAll('#walk-pad button')) {
  const { key } = button.dataset;
  button.addEventListener('pointerdown', () => walker.press(key, true));
  for (const name of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(name, () => walker.press(key, false));
}

$('login').addEventListener('submit', (event) => {
  event.preventDefault();
  login($('code').value);
});

$('lang').addEventListener('click', () => {
  setLang(getLang() === 'ru' ? 'en' : 'ru');
  staticText();
  scene.update(state, config?.cryptsOpen ? t('adLabel') : t('adLabelBeta'));
  renderTicker();
  if (view === 'plot') showPlot(selected);
  graveDialog.relabel();
});

staticText();
config = await api('/api/config');

let refreshTimer = null;
if (config.liveEvents) {
  const events = new EventSource('/api/events');
  events.onmessage = () => {
    // Debounced so a burst of actions doesn't refetch once per event.
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh().catch(() => {}), 500 + Math.random() * 500);
  };
}
setInterval(() => refresh().catch(() => {}), config.liveEvents ? 60_000 : 15_000);

await refresh();
staticText();
applyMapZoom(MAP_ZOOMS[1], false);

// Stripe sends the buyer back here with the order token; drop it from the address bar.
const params = new URLSearchParams(location.search);
const returned = params.get('order');
const cancelled = params.get('cancel');
const editCode = params.get('edit');
if (editCode) {
  // The owner's editor link from /admin; the key must not stay in the address bar.
  history.replaceState(null, '', location.pathname);
  await login(editCode);
}
if (cancelled || (returned && !config.manualPayments)) history.replaceState(null, '', location.pathname);
if (returned) {
  if (config.manualPayments) {
    const order = await api(`/api/orders/${returned}`).catch(() => null);
    if (order?.status === 'paid' && order.code) showPaid(order);
    else if (order?.status === 'pending') showManualPayment(order);
  } else {
    showPayment({ token: returned, fromCheckout: true });
  }
}
if (cancelled) await api(`/api/orders/${cancelled}/cancel`, {}).then(refresh).catch(() => {});
