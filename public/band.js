import { createBandView, BAND_PLAYERS } from './render.js';
import { t, getLang } from './i18n.js';

const BUBBLE_MS = 4500;
const JOKES = {
  ru: [
    'Мы играем до гробовой доски. И после тоже.',
    'Барабанщик опять без ритма. Зато с костями.',
    'Гастроли отменили: кладбище не отпускает.',
    'Фанаты мрут от восторга. Теперь они соседи.',
    'Райдер простой: свечи, тишина после 23:00 и никаких лопат.',
    'Почему без кожи? Так легче гастролировать.',
    'Вход бесплатный, выход обсуждается.',
    'Это наш последний концерт. Уже четыреста лет подряд.',
    'Хитов у нас нет, зато все вечные.',
    'Звукач просил играть живее. Мы не смогли.',
    'Спою без связок. Голосовых тоже нет.',
    'Басист ушёл из группы. Недалеко, через две могилы.',
    'Кто взял мою берцовую? Я на ней играл!',
    'Нас звали на корпоратив. Там было мертвее.',
  ],
  en: [
    'We play until the grave. And then some.',
    'The drummer has no rhythm again. Plenty of bones, though.',
    'The tour is off: this cemetery will not let us leave.',
    'Our fans die of joy. Now they are our neighbours.',
    'Our rider is simple: candles, quiet after 11 pm, no shovels.',
    'Why no skin? It makes touring lighter.',
    'Entry is free. Leaving is negotiable.',
    'This is our farewell show. For the four hundredth year.',
    'We have no hits, but all our songs are evergreen.',
    'The sound guy asked for more life. We could not help him.',
    'Our bassist quit. He did not go far, just two graves over.',
    'Who took my shin? I was playing that!',
  ],
};

export function randomJoke(lang = getLang()) {
  const list = JOKES[lang] ?? JOKES.ru;
  return list[Math.floor(Math.random() * list.length)];
}

// The band on a canvas with jokes taking turns above their heads; the site and the stream both use it.
export function createBandShow(canvas, bubbleLayer, lang) {
  let view = null;
  let timer = null;
  let turn = 0;

  function say(index) {
    const player = BAND_PLAYERS[index];
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = randomJoke(lang);
    bubble.style.left = `${Math.min(80, Math.max(20, player.x))}%`;
    bubble.style.top = `${player.y - 30}%`;
    bubbleLayer.replaceChildren(bubble);
  }

  function next() {
    say(turn % BAND_PLAYERS.length);
    turn += 1 + Math.floor(Math.random() * 3);
  }

  return {
    start() {
      view = createBandView(canvas);
      next();
      timer = setInterval(next, BUBBLE_MS);
    },
    stop() {
      view?.stop();
      view = null;
      clearInterval(timer);
    },
    sayAt(share) {
      const nearest = BAND_PLAYERS.reduce((best, player, index) => (Math.abs(player.x - share) < Math.abs(BAND_PLAYERS[best].x - share) ? index : best), 0);
      say(nearest);
      clearInterval(timer);
      timer = setInterval(next, BUBBLE_MS);
    },
  };
}

// The band fills the whole screen; each player can be clicked, and they joke on their own too.
export function createBandDialog({ music, renderMusicButton }) {
  const dialog = document.getElementById('band-dialog');
  const canvas = document.getElementById('band-canvas');
  const show = createBandShow(canvas, document.getElementById('band-bubbles'));

  canvas.addEventListener('click', (event) => {
    const bounds = canvas.getBoundingClientRect();
    show.sayAt(((event.clientX - bounds.left) / bounds.width) * 100);
  });
  document.getElementById('band-close').addEventListener('click', () => dialog.close());
  document.getElementById('band-music').addEventListener('click', renderMusicButton);
  dialog.addEventListener('close', () => show.stop());

  return {
    open() {
      document.getElementById('band-title').textContent = t('bandTitle');
      document.getElementById('band-hint').textContent = t('bandHint');
      document.getElementById('band-music').textContent = music.playing ? t('musicOn') : t('musicOff');
      dialog.showModal();
      show.start();
    },
  };
}
