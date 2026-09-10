/**
 * 软西瓜 Melt Melon — 微信小游戏入口
 * 延迟到 jsbridge / 系统信息就绪后再构造 Game，避免 getSystemInfo fail
 */
var Game = require('./js/game-core.js');

var started = false;

function readSysSafe() {
  try {
    if (typeof wx === 'undefined' || !wx.getSystemInfoSync) return null;
    var sys = wx.getSystemInfoSync();
    if (!sys) return null;
    var w = sys.windowWidth || sys.screenWidth || 0;
    var h = sys.windowHeight || sys.screenHeight || 0;
    if (w > 0 && h > 0) return sys;
    return null;
  } catch (e) {
    return null;
  }
}

function boot() {
  if (started) return true;
  // Prefer system info; Game itself also falls back to canvas metrics
  var sys = readSysSafe();
  var canvasReady = typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';
  if (!canvasReady) return false;
  // If sys missing, still try once bridge looks alive (createCanvas exists)
  if (!sys && !wx.createCanvas) return false;

  try {
    var game = new Game();
    game.start();
    started = true;
    return true;
  } catch (e) {
    console.warn('[melt-melon] boot failed, will retry', e);
    return false;
  }
}

function scheduleRetries() {
  var delays = [0, 16, 50, 100, 200, 500, 1000];
  for (var i = 0; i < delays.length; i++) {
    (function (ms) {
      setTimeout(function () {
        if (!started) boot();
      }, ms);
    })(delays[i]);
  }
  if (typeof wx !== 'undefined' && typeof wx.onShow === 'function') {
    wx.onShow(function () {
      if (!started) boot();
    });
  }
}

if (!boot()) {
  scheduleRetries();
}
