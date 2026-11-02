import { createScene, createCloseup } from './render.js';
import { t } from './i18n.js';

const FOCUS_MS = 20_000;
const $ = (id) => document.getElementById(id);
const scene = createScene($('map'));
const focusView = createCloseup($('focus'));

let state = null;
let cursor = 0;
let holdUntil = 0;
let focusPlot = null;

const both = (key, vars) => `${t(key, vars, 'ru')} / ${t(key, vars, 'en')}`;

function renderFocus() {
  const plot = focusPlot === null ? null : state.plots[focusPlot];
  if (!plot?.grave) {
    $('focus').style.visibility = 'hidden';
    $('focus-name').textContent = '';
    $('focus-epitaph').textContent = '';
    $('focus-stage').textContent = both('streamEmpty');
    return;
  }
  $('focus').style.visibility = 'visible';
  focusView.set(plot);
  $('focus-name').textContent = plot.grave.name;
  $('focus-epitaph').textContent = plot.grave.epitaph ? `« ${plot.grave.epitaph} »` : '';
  $('focus-stage').textContent = both(`stage${plot.grave.stage}`);
}

function renderEvents() {
  $('events').replaceChildren(...state.recent.slice(0, 5).map((event) => {
    const li = document.createElement('li');
    li.textContent = both(`event_${event.type}`, { name: event.name });
    return li;
  }));
}

async function refresh() {
  state = await (await fetch('/api/state')).json();
  scene.update(state, 'VIP BETA');
  scene.setSelected(focusPlot);
  renderEvents();
  renderFocus();
}

function nextFocus() {
  if (Date.now() < holdUntil || !state) return;
  const graves = state.plots.filter((plot) => plot.grave && !plot.ad);
  if (!graves.length) {
    focusPlot = null;
  } else {
    cursor = (cursor + 1) % graves.length;
    focusPlot = graves[cursor].plot;
  }
  scene.setSelected(focusPlot);
  renderFocus();
}

const config = await (await fetch('/api/config')).json();
if (config.liveEvents) {
  const events = new EventSource('/api/events');
  events.onmessage = async (message) => {
    const data = JSON.parse(message.data);
    if (data.plot !== undefined && !state?.plots[data.plot]?.ad) {
      focusPlot = data.plot;
      holdUntil = Date.now() + FOCUS_MS;
    }
    await refresh().catch(() => {});
  };
}

const ctaKey = config.ordersOpen ? 'streamCta' : 'streamBetaCta';
$('cta-ru').textContent = t(ctaKey, {}, 'ru');
$('cta-en').textContent = t(ctaKey, {}, 'en');
setInterval(() => refresh().catch(() => {}), 60_000);
setInterval(nextFocus, FOCUS_MS);
await refresh();
nextFocus();
