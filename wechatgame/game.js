/**
 * 软西瓜 Melt Melon — 微信小游戏入口
 * 先在全局接住触摸事件，再启动 Game（开发者工具里直绑经常收不到）
 */
var Game = require('./js/game-core.js');

var g = typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : {});
if (!g.__meltTouchQ) g.__meltTouchQ = [];
if (!g.__meltTouchStat) g.__meltTouchStat = { n: 0, last: 'none' };

function pickNum() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (typeof v === 'number' && !isNaN(v)) return v;
  }
  return null;
}

function extractXY(e) {
  if (!e) return null;
  var t = null;
  if (e.touches && e.touches.length) t = e.touches[0];
  else if (e.changedTouches && e.changedTouches.length) t = e.changedTouches[0];
  else t = e;
  if (!t) return null;
  var x = pickNum(t.x, t.clientX, t.pageX, e.x, e.clientX, e.pageX);
  var y = pickNum(t.y, t.clientY, t.pageY, e.y, e.clientY, e.pageY);
  if (x == null || y == null) return null;
  return { x: x, y: y };
}

function pushTouch(type, e) {
  var p = extractXY(e);
  g.__meltTouchStat.n += 1;
  g.__meltTouchStat.last = type + (p ? '@' + Math.round(p.x) + ',' + Math.round(p.y) : '@null');
  // 即使坐标解析失败也入队，方便调试
  g.__meltTouchQ.push({
    type: type,
    x: p ? p.x : 0,
    y: p ? p.y : 0,
    ok: !!p,
    t: Date.now(),
  });
  // 队列过长时丢弃旧事件
  if (g.__meltTouchQ.length > 64) {
    g.__meltTouchQ.splice(0, g.__meltTouchQ.length - 64);
  }
}

function bindGlobalTouch() {
  if (typeof wx === 'undefined') return;
  if (g.__meltTouchBound) return;
  g.__meltTouchBound = true;
  try {
    if (wx.onTouchStart) wx.onTouchStart(function (e) { pushTouch('start', e); });
    if (wx.onTouchMove) wx.onTouchMove(function (e) { pushTouch('move', e); });
    if (wx.onTouchEnd) wx.onTouchEnd(function (e) { pushTouch('end', e); });
    if (wx.onTouchCancel) wx.onTouchCancel(function (e) { pushTouch('cancel', e); });
  } catch (err) {
    console.warn('[melt-melon] bind touch failed', err);
    g.__meltTouchBound = false;
  }
}

bindGlobalTouch();
if (typeof wx !== 'undefined' && wx.onShow) {
  wx.onShow(function () {
    g.__meltTouchBound = false;
    bindGlobalTouch();
  });
}

var started = false;
var gameRef = null;

function boot() {
  if (started) return true;
  if (typeof wx === 'undefined' || typeof wx.createCanvas !== 'function') return false;
  bindGlobalTouch();
  try {
    gameRef = new Game();
    gameRef.start();
    started = true;
    console.log('[melt-melon] booted, touch bridge on');
    return true;
  } catch (e) {
    console.warn('[melt-melon] boot failed, will retry', e);
    return false;
  }
}

function scheduleRetries() {
  var delays = [0, 50, 100, 200, 500, 1000, 2000];
  for (var i = 0; i < delays.length; i++) {
    (function (ms) {
      setTimeout(function () {
        if (!started) boot();
      }, ms);
    })(delays[i]);
  }
}

if (!boot()) scheduleRetries();
