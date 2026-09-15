/**
 * Soft jelly SFX via WeChat WebAudio (wx.createWebAudioContext).
 * Ported from melt-melon reference: drop / merge / impact "duang" tones.
 */
var enabled = true;
var audioContext = null;
var audioBus = null;
var lastImpactAudioTime = 0;
var visualTime = 0;

function createContext() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function') {
      return wx.createWebAudioContext();
    }
  } catch (e) { /* ignore */ }
  try {
    var Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
    if (Ctor) return new Ctor();
  } catch (e2) { /* ignore */ }
  return null;
}

function unlock() {
  if (!enabled) return;
  if (!audioContext) {
    audioContext = createContext();
    if (!audioContext) return;
    try {
      var compressor = audioContext.createDynamicsCompressor
        ? audioContext.createDynamicsCompressor()
        : null;
      audioBus = audioContext.createGain();
      audioBus.gain.value = 0.28;
      if (compressor) {
        audioBus.connect(compressor);
        compressor.connect(audioContext.destination);
      } else {
        audioBus.connect(audioContext.destination);
      }
    } catch (e) {
      audioBus = null;
      audioContext = null;
      return;
    }
  }
  try {
    if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
      audioContext.resume();
    }
  } catch (e2) { /* ignore */ }
}

function isReady() {
  if (!(enabled && audioContext && audioBus)) return false;
  // Browser may be suspended until gesture; WeChat WebAudio is often already running / has no state.
  var st = audioContext.state;
  return !st || st === 'running' || st === 'suspended';
}

function playTone(freqStart, freqEnd, peakGain, duration, type) {
  if (!isReady()) return;
  try {
    var now = audioContext.currentTime;
    var oscillator = audioContext.createOscillator();
    var envelope = audioContext.createGain();
    oscillator.type = type || 'sine';
    oscillator.frequency.setValueAtTime(freqStart, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    envelope.gain.setValueAtTime(0.001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(envelope);
    envelope.connect(audioBus);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.onended = function () {
      try { oscillator.disconnect(); envelope.disconnect(); } catch (e) { /* ignore */ }
    };
  } catch (e) { /* ignore */ }
}

/** kind: 'drop' | 'merge' | 'win' | 'soften' */
function play(kind, level, combo) {
  if (!enabled) return;
  unlock();
  if (!(audioContext && audioBus)) return;
  level = level || 0;
  combo = combo || 1;
  var now = audioContext.currentTime;
  var frequencies;
  if (kind === 'win') {
    frequencies = [261.63, 329.63, 392, 523.25];
  } else if (kind === 'merge') {
    frequencies = [220 * Math.pow(2, level / 7), 330 * Math.pow(2, level / 7)];
  } else if (kind === 'soften') {
    frequencies = [164.81, 196, 246.94];
  } else {
    frequencies = [185];
  }
  for (var index = 0; index < frequencies.length; index++) {
    (function (frequency, i) {
      try {
        var oscillator = audioContext.createOscillator();
        var envelope = audioContext.createGain();
        var start = now + i * (kind === 'win' ? 0.095 : 0.04);
        var duration = kind === 'drop' ? 0.08 : kind === 'merge' ? 0.16 : kind === 'soften' ? 0.24 : 0.32;
        var pitch = frequency * (kind === 'merge' ? Math.pow(2, Math.min(combo - 1, 4) * 2 / 12) : 1);
        var startMul = (kind === 'drop' || (kind === 'merge' && i === 0)) ? 1.65 : 1;
        var endMul = (kind === 'drop' || (kind === 'merge' && i === 0)) ? 0.6 : 1.008;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(pitch * startMul, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, pitch * endMul), start + duration);
        envelope.gain.setValueAtTime(0.001, start);
        envelope.gain.exponentialRampToValueAtTime(
          kind === 'drop' ? 0.1 : 0.16 + Math.min(combo, 4) * 0.008,
          start + 0.012
        );
        envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
        oscillator.connect(envelope);
        envelope.connect(audioBus);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
        oscillator.onended = function () {
          try { oscillator.disconnect(); envelope.disconnect(); } catch (e) { /* ignore */ }
        };
      } catch (e2) { /* ignore */ }
    })(frequencies[index], index);
  }
}

/** Soft collision "duang" from SoftWorld impact events. */
function playImpact(event, bodyRadius) {
  if (!enabled) return;
  if (visualTime - lastImpactAudioTime < 0.08) return;
  if (!event || !(event.speed > 115)) return;
  unlock();
  if (!(audioContext && audioBus)) return;
  lastImpactAudioTime = visualTime;
  var radius = bodyRadius != null ? bodyRadius : 30;
  var strength = Math.min(1, event.speed / 850);
  var frequency = Math.max(95, 260 - radius * 1.3);
  playTone(frequency * 1.8, frequency * 0.7, 0.07 + strength * 0.13, 0.16, 'sine');
}

function tick(dtSec) {
  visualTime += dtSec > 0 ? dtSec : 0;
}

function setEnabled(on) {
  enabled = !!on;
  if (enabled) unlock();
}

function isEnabled() {
  return enabled;
}

module.exports = {
  unlock: unlock,
  play: play,
  playImpact: playImpact,
  tick: tick,
  setEnabled: setEnabled,
  isEnabled: isEnabled,
};
