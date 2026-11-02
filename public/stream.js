import { createScene, createCloseup } from './render.js';
import { t } from './i18n.js';
import { createCrowd, diggerAt } from './walk.js';
import { createMusic } from './music.js';
import { createBandShow } from './band.js';
import { renderBoard } from './board.js';

const FOCUS_MS = 20_000;
const LIVE_MS = 3000;
const FOLLOW_ZOOM = 3;
const MAP_LEFT = 66;
const MAP_TOP = 2;
const MAP_WIDTH = 1788;
const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;
// The automatic show: a grave, a minute of the cemetery, the band, another minute, and round again.
// The camera takes the second half of each minute; the board gets its turn once something happened.
const ROUND = [
  ['grave', 30], ['map', 30], ['follow', 30],
  ['band', 30], ['map', 30], ['follow', 30],
  ['board', 20],
];
const $ = (id) => document.getElementById(id);
const scene = createScene($('map'));
const focusView = createCloseup($('focus'));
const crowd = createCrowd();
const bandShow = createBandShow($('band-canvas'), $('band-bubbles'), 'ru');

let state = null;
let cursor = 0;
let spotlight = null;
let autoshow = false;
let build = null;
let focusPlot = null;
let view = null;
let phase = -1;
let phaseEnds = 0;
let boardData = null;
let people = [];
let followed = null;

const both = (key, vars) => `${t(key, vars, 'ru')} / ${t(key, vars, 'en')}`;

function renderFocus() {
  const plot = focusPlot === null || !state ? null : state.plots[focusPlot];
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
  $('focus-stage').textContent = `${t('plotNumber', { n: plot.plot + 1 }, 'ru')} · ${both(`stage${plot.grave.stage}`)}`;
}

function renderEvents() {
  $('events').replaceChildren(...state.recent.slice(0, 3).map((event) => {
    const li = document.createElement('li');
    li.textContent = both(`event_${event.type}`, { name: event.name });
    return li;
  }));
}

async function refresh() {
  state = await (await fetch('/api/state')).json();
  scene.update(state, 'VIP BETA');
  scene.setSelected(view === 'grave' ? focusPlot : null);
  renderEvents();
  renderFocus();
}

function nextGrave() {
  const graves = state?.plots.filter((plot) => plot.grave && !plot.ad) ?? [];
  if (!graves.length) {
    focusPlot = null;
    return;
  }
  cursor = (cursor + 1) % graves.length;
  focusPlot = graves[cursor].plot;
}

function pickFollowed() {
  const walkers = people.filter((person) => person.moving);
  const pool = walkers.length ? walkers : people;
  followed = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : 'digger';
}

// Everything the screen can show goes through here, so two views can never overlap.
function show(next) {
  const was = view;
  view = next;
  if (was === 'band' && next !== 'band') {
    bandShow.stop();
    $('band-screen').hidden = true;
  }
  if (next === 'band' && was !== 'band') {
    $('band-screen').hidden = false;
    bandShow.start();
  }
  $('board-screen').hidden = next !== 'board';
  if (next === 'board' && boardData) {
    $('board-title').textContent = t('boardTip', {}, 'ru');
    renderBoard($('board-content'), boardData, 6);
  }
  document.body.classList.toggle('spotlit', next === 'grave');
  document.body.classList.toggle('following', next === 'follow');
  if (next === 'follow' && was !== 'follow') pickFollowed();
  if (next !== 'follow') {
    $('map-box').style.transform = '';
    $('camera-caption').textContent = '';
  }
  scene.setSelected(next === 'grave' ? focusPlot : null);
  renderFocus();
}

function stepAutoshow() {
  if (Date.now() < phaseEnds) return;
  phase = (phase + 1) % ROUND.length;
  let [kind, seconds] = ROUND[phase];
  // Nothing to report yet: the board skips its turn and the next phase starts right away.
  if (kind === 'board' && !boardData?.entries.length) {
    phase = 0;
    [kind, seconds] = ROUND[phase];
  }
  if (kind === 'grave') nextGrave();
  phaseEnds = Date.now() + seconds * 1000;
  show(kind);
}

function applyControl() {
  if (typeof spotlight === 'number') {
    focusPlot = spotlight;
    show('grave');
  } else if (spotlight) {
    show(spotlight);
  } else if (autoshow) {
    stepAutoshow();
  } else if (view !== 'map') {
    show('map');
  }
}

async function readLive() {
  const live = await (await fetch('/api/live?stream=1')).json();
  // OBS keeps a page open for hours: after a new version goes live, it must pick it up by itself.
  if (build !== null && live.build !== build) location.reload();
  build = live.build;
  crowd.update(live.visitors);
  scene.setGhost(live.ghost);
  const changed = live.spotlight !== spotlight || live.autoshow !== autoshow;
  spotlight = live.spotlight;
  autoshow = live.autoshow;
  if (changed) {
    // Taking the screen back from a manual view restarts the round from its next step.
    phaseEnds = 0;
    applyControl();
  }
  boardData = await (await fetch('/api/board')).json();
  if (view === 'board') renderBoard($('board-content'), boardData, 6);
}

function followCamera() {
  const everyone = [...people, diggerAt(Date.now(), t('diggerName', {}, 'ru'))];
  const person = everyone.find((candidate) => candidate.id === followed);
  if (!person) {
    pickFollowed();
    return;
  }
  const [shareX, shareY] = scene.shareOf(person.c, person.r);
  const mapHeight = $('map').offsetHeight;
  const x = STAGE_WIDTH / 2 - MAP_LEFT - shareX * MAP_WIDTH * FOLLOW_ZOOM;
  const y = STAGE_HEIGHT / 2 - MAP_TOP - shareY * mapHeight * FOLLOW_ZOOM;
  $('map-box').style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${FOLLOW_ZOOM})`;
  $('camera-caption').textContent = t('streamCamera', { nick: person.nick }, 'ru');
}

const config = await (await fetch('/api/config')).json();
if (config.liveEvents) {
  const events = new EventSource('/api/events');
  events.onmessage = () => refresh().catch(() => {});
}

let lastFrame = performance.now();
(function glide(time) {
  requestAnimationFrame(glide);
  people = crowd.tick(Math.min(0.1, (time - lastFrame) / 1000));
  lastFrame = time;
  scene.setVisitors([...people, diggerAt(Date.now(), t('diggerName', {}, 'ru'))]);
  if (view === 'follow' && state) followCamera();
}(lastFrame));

// OBS has no one to click the page, so the sound is asked for in the address: /stream?music=1
if (new URLSearchParams(location.search).get('music') === '1') createMusic().start();

const ctaKey = config.ordersOpen ? 'streamCta' : 'streamBetaCta';
$('cta-ru').textContent = t(ctaKey, {}, 'ru');
$('cta-en').textContent = t(ctaKey, {}, 'en');
setInterval(() => refresh().catch(() => {}), 60_000);
setInterval(() => readLive().catch(() => {}), LIVE_MS);
// Graves still take turns in the corner card whenever the cemetery itself is on screen.
setInterval(() => {
  if (view === 'map' || view === 'follow') {
    nextGrave();
    renderFocus();
  }
}, FOCUS_MS);
setInterval(() => {
  if (autoshow && spotlight === null) stepAutoshow();
}, 1000);
await refresh();
await readLive().catch(() => {});
if (view === null) applyControl();
