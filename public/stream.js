import { createScene, createCloseup } from './render.js';
import { t } from './i18n.js';
import { createCrowd } from './walk.js';
import { createMusic } from './music.js';
import { createBandShow } from './band.js';

const FOCUS_MS = 20_000;
const LIVE_MS = 3000;
const $ = (id) => document.getElementById(id);
const scene = createScene($('map'));
const focusView = createCloseup($('focus'));

let state = null;
let cursor = 0;
let spotlight = null;
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

// The owner picks a grave in /admin and it stays on air; otherwise the graves take turns.
function nextFocus() {
  if (spotlight !== null || !state) return;
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
  events.onmessage = () => refresh().catch(() => {});
}

const crowd = createCrowd();
const bandShow = createBandShow($('band-canvas'), $('band-bubbles'), 'ru');
let build = null;
async function readLive() {
  const live = await (await fetch('/api/live?stream=1')).json();
  // OBS keeps a page open for hours: after a new version goes live, it must pick it up by itself.
  if (build !== null && live.build !== build) location.reload();
  build = live.build;
  crowd.update(live.visitors);
  document.body.classList.toggle('spotlit', typeof live.spotlight === 'number');
  if (live.spotlight !== spotlight) {
    const wasBand = spotlight === 'band';
    spotlight = live.spotlight;
    if (wasBand) {
      bandShow.stop();
      $('band-screen').hidden = true;
    }
    if (spotlight === 'band') {
      $('band-screen').hidden = false;
      bandShow.start();
    } else if (spotlight === null) {
      nextFocus();
    } else {
      focusPlot = spotlight;
      scene.setSelected(focusPlot);
      renderFocus();
    }
  }
}
setInterval(() => readLive().catch(() => {}), LIVE_MS);
let lastFrame = performance.now();
(function glide(time) {
  requestAnimationFrame(glide);
  scene.setVisitors(crowd.tick(Math.min(0.1, (time - lastFrame) / 1000)));
  lastFrame = time;
}(lastFrame));

// OBS has no one to click the page, so the sound is asked for in the address: /stream?music=1
if (new URLSearchParams(location.search).get('music') === '1') createMusic().start();

const ctaKey = config.ordersOpen ? 'streamCta' : 'streamBetaCta';
$('cta-ru').textContent = t(ctaKey, {}, 'ru');
$('cta-en').textContent = t(ctaKey, {}, 'en');
setInterval(() => refresh().catch(() => {}), 60_000);
setInterval(nextFocus, FOCUS_MS);
await refresh();
nextFocus();
