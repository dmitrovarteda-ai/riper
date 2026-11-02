// Background music generated in the browser, so there is no track to license and nothing to download.
const BPM = 112;
const STEPS_PER_BEAT = 2;
const LOOK_AHEAD_S = 0.25;
const VOLUME = 0.16;

// A cheerful minor polka: bass on the beat, a bony xylophone melody on top. Zero is a rest.
const BASS = [110, 0, 165, 0, 110, 0, 165, 0, 98, 0, 147, 0, 98, 0, 147, 0, 87.3, 0, 131, 0, 87.3, 0, 131, 0, 82.4, 0, 124, 0, 82.4, 0, 165, 0];
const MELODY = [
  440, 523, 659, 523, 440, 0, 330, 0, 392, 494, 587, 494, 392, 0, 294, 0,
  349, 440, 523, 440, 349, 0, 262, 0, 330, 415, 494, 659, 494, 415, 330, 0,
  659, 0, 587, 523, 494, 0, 440, 0, 587, 0, 523, 494, 440, 0, 392, 0,
  523, 0, 494, 440, 415, 494, 330, 415, 440, 0, 0, 330, 440, 0, 0, 0,
];

export function createMusic() {
  let audio = null;
  let master = null;
  let timer = null;
  let step = 0;
  let nextAt = 0;

  function note(frequency, at, length, type, level) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + length);
  }

  function schedule() {
    const stepLength = 60 / BPM / STEPS_PER_BEAT;
    while (nextAt < audio.currentTime + LOOK_AHEAD_S) {
      const bass = BASS[step % BASS.length];
      const tune = MELODY[step % MELODY.length];
      if (bass) note(bass, nextAt, stepLength * 1.6, 'triangle', 0.9);
      if (tune) {
        note(tune, nextAt, stepLength * 0.9, 'square', 0.12);
        note(tune * 2, nextAt, stepLength * 0.45, 'sine', 0.3);
      }
      step += 1;
      nextAt += stepLength;
    }
  }

  return {
    get playing() {
      return timer !== null;
    },
    start() {
      if (timer !== null) return;
      if (!audio) {
        audio = new AudioContext();
        master = audio.createGain();
        master.gain.value = VOLUME;
        master.connect(audio.destination);
      }
      audio.resume();
      nextAt = audio.currentTime + 0.05;
      schedule();
      timer = setInterval(schedule, 100);
    },
    stop() {
      clearInterval(timer);
      timer = null;
      audio?.suspend();
    },
  };
}
