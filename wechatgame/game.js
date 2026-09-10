/**
 * 软西瓜 Melt Melon — 微信小游戏入口
 * Boot when createCanvas works; do not require getSystemInfoSync.
 */
var Game = require('./js/game-core.js');

var started = false;

function boot() {
  if (started) return true;
  var canvasReady = typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';
  if (!canvasReady) return false;

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
