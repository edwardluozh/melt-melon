/**
 * 软西瓜 M1 — 微信小游戏主逻辑
 * 无 DOM：HUD / 按钮 / 结算层全部画在主 canvas 上
 *
 * 坐标模型：canvas 缓冲区 = css * dpr，每帧 ctx.setTransform(dpr,…)
 * 之后全部用「屏幕 CSS 像素」绘制与命中，与 touch clientX/Y 一致。
 */
var Matter = require('./matter.min.js');
var fruits = require('./fruits.js');
var physics = require('./physics.js');
var merge = require('./merge.js');
var scoreMod = require('./score.js');

var getFruit = fruits.getFruit;
var drawFruit = fruits.drawFruit;
var randomDropLevel = fruits.randomDropLevel;
var preloadFruitImages = fruits.preloadFruitImages;
var LOGICAL_W = physics.LOGICAL_W;
var LOGICAL_H = physics.LOGICAL_H;
var FAIL_LINE_Y = physics.FAIL_LINE_Y;
var DROP_Y = physics.DROP_Y;
var createEngine = physics.createEngine;
var createWalls = physics.createWalls;
var createFruitBody = physics.createFruitBody;
var getFruitData = physics.getFruitData;
var isFruitBody = physics.isFruitBody;
var isWallBody = physics.isWallBody;
var fixedStep = physics.fixedStep;
var applyJellySquash = physics.applyJellySquash;
var updateJelly = physics.updateJelly;
var attachMergeHandler = merge.attachMergeHandler;
var ScoreManager = scoreMod.ScoreManager;

var DROP_COOLDOWN_MS = 450;
var FAIL_HOLD_MS = 3000;
var ENERGY_DEFAULT = 100;
var PLAY_BOTTOM_PAD = 8;

/** Never retry getSystemInfoSync after a failure (jsbridge not ready spam). */
var neverRetrySysInfo = false;
var sysInfoCached = null;
var sysInfoTried = false;

function nowMs() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

function readMenuButton() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getMenuButtonBoundingClientRect === 'function') {
      var r = wx.getMenuButtonBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      }
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function readWindowInfoSafe() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getWindowInfo === 'function') {
      var info = wx.getWindowInfo();
      if (info) return info;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function readSystemInfoOnce() { return null; }

/**
 * Prefer canvas size + menuButton + getWindowInfo; getSystemInfoSync only once.
 */
function readSystemMetrics(canvas) {
  var pixelRatio = 2;
  var screenW = 0;
  var screenH = 0;
  var safeTop = 0;
  var safeBottom = 0;
  var menuButton = readMenuButton();

  // 1) getWindowInfo if available (no legacy bridge spam)
  var win = readWindowInfoSafe();
  if (win) {
    if (win.pixelRatio > 0) pixelRatio = win.pixelRatio;
    if (win.windowWidth > 0) screenW = win.windowWidth;
    if (win.windowHeight > 0) screenH = win.windowHeight;
    if (win.safeArea && typeof win.safeArea.top === 'number') {
      safeTop = Math.max(0, win.safeArea.top);
    } else if (typeof win.statusBarHeight === 'number') {
      safeTop = Math.max(0, win.statusBarHeight);
    }
    if (win.safeArea && typeof win.safeArea.bottom === 'number' && win.screenHeight > 0) {
      safeBottom = Math.max(0, win.screenHeight - win.safeArea.bottom);
    }
  }

  // getSystemInfoSync 已禁用：模拟器常抛 jsbridge not ready

  // Infer safeTop from menu button when status bar unknown
  if (safeTop <= 0 && menuButton && menuButton.top > 0) {
    safeTop = Math.max(0, menuButton.top);
  }

  // 3) Prefer canvas buffer size when system info was zero / missing
  if (canvas) {
    var cw = canvas.width || 0;
    var ch = canvas.height || 0;
    if ((!screenW || screenW <= 0) && cw > 0) {
      screenW = Math.round(cw / pixelRatio) || cw;
    }
    if ((!screenH || screenH <= 0) && ch > 0) {
      screenH = Math.round(ch / pixelRatio) || ch;
    }
    if (cw > 0 && ch > 0 && (screenW <= 0 || screenH <= 0)) {
      screenW = cw;
      screenH = ch;
      pixelRatio = 1;
    }
  }

  if (!screenW || screenW <= 0) screenW = 375;
  if (!screenH || screenH <= 0) screenH = 667;
  if (!pixelRatio || pixelRatio <= 0) pixelRatio = 2;

  return {
    pixelRatio: pixelRatio,
    screenW: screenW,
    screenH: screenH,
    safeTop: safeTop,
    safeBottom: safeBottom,
    menuButton: menuButton,
  };
}

function Game() {
  this.canvas = wx.createCanvas();
  this.ctx = this.canvas.getContext('2d');

  var metrics = readSystemMetrics(this.canvas);
  this.pixelRatio = metrics.pixelRatio;
  this.screenW = metrics.screenW;
  this.screenH = metrics.screenH;
  this.safeTop = metrics.safeTop;
  this.safeBottom = metrics.safeBottom;
  this.menuButton = metrics.menuButton;

  // Buffer = CSS * dpr；绘制用 setTransform(dpr) 后走屏幕坐标
  this.canvas.width = Math.max(1, Math.floor(this.screenW * this.pixelRatio));
  this.canvas.height = Math.max(1, Math.floor(this.screenH * this.pixelRatio));

  // Re-read if createCanvas populated size and earlier metrics were defaults
  if (this.canvas.width > 0 && this.canvas.height > 0) {
    metrics = readSystemMetrics(this.canvas);
    this.pixelRatio = metrics.pixelRatio;
    this.screenW = metrics.screenW;
    this.screenH = metrics.screenH;
    this.safeTop = metrics.safeTop;
    this.safeBottom = metrics.safeBottom;
    this.menuButton = metrics.menuButton;
    this.canvas.width = Math.max(1, Math.floor(this.screenW * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.floor(this.screenH * this.pixelRatio));
  }

  this.engine = createEngine();
  createWalls(this.engine.world);
  this.scoreMgr = new ScoreManager();

  this.pendingLevel = randomDropLevel();
  this.nextLevel = randomDropLevel();
  this.aiming = false;
  this.aimX = LOGICAL_W / 2;
  this.pointerMode = 'idle';
  this.canDrop = true;
  this.gameOver = false;
  this.running = false;
  this.lastTs = 0;
  this.energy = ENERGY_DEFAULT;
  this.floatTexts = [];
  this.physAccum = { value: 0 };

  this.fruitImages = {};

  // Layout rects (filled by _layout)
  this.topPad = 0;
  this.scoresY = 0;
  this.nextPreview = { x: 0, y: 0 };
  this.HUD_H = 128;
  this.playScale = 1;
  this.playOffsetX = 0;
  this.playOffsetY = this.HUD_H;
  this.hitSoft = { x: 0, y: 0, w: 0, h: 0 };
  this.hitRestart = { x: 0, y: 0, w: 0, h: 0 };
  this.hitDrop = { x: 0, y: 0, w: 0, h: 0 };
  this.hitNudgeL = { x: 0, y: 0, w: 0, h: 0 };
  this.hitNudgeR = { x: 0, y: 0, w: 0, h: 0 };
  this.hitOverlayRestart = { x: 0, y: 0, w: 0, h: 0 };
  this._debugTouch = { x: 0, y: 0, mode: 'idle' };

  this._layout();
  this._bindMerge();
  this._bindJelly();
  this._bindTouch();
  this._preloadImages();
}

Game.prototype._preloadImages = function () {
  var self = this;
  preloadFruitImages(function (map) {
    self.fruitImages = map || {};
  });
};

Game.prototype.start = function () {
  if (this.running) return;
  this.running = true;
  this.lastTs = nowMs();
  var self = this;

  // 开发者工具里 requestAnimationFrame 经常不回调 → 主循环用 setInterval
  if (this._loopTimer) {
    clearInterval(this._loopTimer);
    this._loopTimer = null;
  }
  this._loopTimer = setInterval(function () {
    if (!self.running) return;
    var t = nowMs();
    var dt = Math.min(50, Math.max(0, t - self.lastTs));
    // 首帧或卡住时给一个稳定步长
    if (!(dt > 0) || dt > 100) dt = 16;
    self.lastTs = t;
    try {
      self._update(dt);
      self._render();
    } catch (err) {
      console.error('[melt-melon] frame error', err);
      if (self._debugTouch) {
        self._debugTouch.mode = 'ERR';
      }
    }
  }, 16);

  // 启动约 1 秒后自动落一颗，验证循环/物理是否在跑
  setTimeout(function () {
    if (!self.running || self.gameOver || !self.canDrop) return;
    self._dropFruit();
    if (self._debugTouch) self._debugTouch.mode = 'auto-drop';
  }, 1000);
};

/**
 * Capsule-safe HUD layout:
 * - scores left on row1 below status / capsule
 * - next preview left of capsule (or under scores)
 * - buttons on second row fully below capsule
 * - HUD_H = buttons.bottom + 12
 */
Game.prototype._layout = function () {
  var mb = this.menuButton;
  var safeTop = this.safeTop || 0;
  var topPad = mb ? mb.bottom + 10 : safeTop + 24;
  this.topPad = topPad;
  this.scoresY = topPad;

  var pad = 12;
  var btnH = 34;
  var softW = 84;
  var restartW = 84;
  var dropW = 72;
  var nudgeW = 36;
  var btnY = topPad + 44;
  var leftPad = 14;

  // Next preview: left of capsule at vertical center, else under scores
  var previewR = 18;
  var nextX;
  var nextY;
  if (mb && mb.left - previewR - 8 > leftPad + 200) {
    nextX = mb.left - 36;
    nextY = mb.top + mb.height / 2;
  } else {
    nextX = leftPad + 48;
    nextY = topPad + 52;
    // If preview falls on button row, push buttons lower
    if (nextY + previewR + 8 > btnY) {
      btnY = nextY + previewR + 12;
    }
  }
  this.nextPreview = { x: nextX, y: nextY, r: previewR };

  // Energy must end before capsule left
  this.energyMaxX = mb ? mb.left - 8 : this.screenW - 8;
  this.scoresMaxX = this.energyMaxX;

  var right = this.screenW - pad;
  this.hitRestart = {
    x: right - restartW,
    y: btnY,
    w: restartW,
    h: btnH,
  };
  this.hitDrop = {
    x: this.hitRestart.x - dropW - 8,
    y: btnY,
    w: dropW,
    h: btnH,
  };
  this.hitSoft = {
    x: this.hitDrop.x - softW - 8,
    y: btnY,
    w: softW,
    h: btnH,
  };
  // Left/right nudge beside soft button when space allows
  this.hitNudgeL = {
    x: Math.max(pad, this.hitSoft.x - nudgeW * 2 - 12),
    y: btnY,
    w: nudgeW,
    h: btnH,
  };
  this.hitNudgeR = {
    x: this.hitNudgeL.x + nudgeW + 6,
    y: btnY,
    w: nudgeW,
    h: btnH,
  };
  // Avoid overlap with soft if screen is narrow
  if (this.hitNudgeR.x + this.hitNudgeR.w + 4 > this.hitSoft.x) {
    this.hitNudgeL = { x: 0, y: 0, w: 0, h: 0 };
    this.hitNudgeR = { x: 0, y: 0, w: 0, h: 0 };
  }

  this.HUD_H = btnY + btnH + 18;

  var hudH = this.HUD_H;
  var bottomPad = Math.max(PLAY_BOTTOM_PAD, this.safeBottom || 0);
  var availW = this.screenW;
  var availH = Math.max(120, this.screenH - hudH - bottomPad);
  var fit = Math.min(availW / LOGICAL_W, availH / LOGICAL_H);
  this.playScale = fit;
  this.playOffsetX = (availW - LOGICAL_W * fit) / 2;
  this.playOffsetY = hudH + Math.max(0, (availH - LOGICAL_H * fit) / 2);
};

Game.prototype._bindMerge = function () {
  var self = this;
  attachMergeHandler(
    this.engine,
    function (baseScore, _level, x, y) {
      var gained = self.scoreMgr.addMerge(baseScore);
      self.floatTexts.push({
        x: x,
        y: y,
        text: '+' + gained,
        life: 700,
      });
    },
    function () {
      return !self.gameOver;
    }
  );
};

Game.prototype._bindJelly = function () {
  var engine = this.engine;
  Matter.Events.on(engine, 'collisionStart', function (event) {
    var pairs = event.pairs;
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      var a = pair.bodyA;
      var b = pair.bodyB;
      var aFruit = isFruitBody(a);
      var bFruit = isFruitBody(b);
      if (!aFruit && !bFruit) continue;
      // fruit-fruit or fruit-wall
      if (!(aFruit && bFruit) && !(aFruit && isWallBody(b)) && !(bFruit && isWallBody(a))) {
        continue;
      }

      var nx = 0;
      var ny = 1;
      if (pair.collision && pair.collision.normal) {
        nx = pair.collision.normal.x;
        ny = pair.collision.normal.y;
      } else {
        var dx = b.position.x - a.position.x;
        var dy = b.position.y - a.position.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        nx = dx / len;
        ny = dy / len;
      }

      var rvx = (a.velocity ? a.velocity.x : 0) - (b.velocity ? b.velocity.x : 0);
      var rvy = (a.velocity ? a.velocity.y : 0) - (b.velocity ? b.velocity.y : 0);
      var speed = Math.sqrt(rvx * rvx + rvy * rvy);

      if (aFruit) {
        applyJellySquash(a, { x: -nx, y: -ny }, speed);
      }
      if (bFruit) {
        applyJellySquash(b, { x: nx, y: ny }, speed);
      }
    }
  });
};


Game.prototype._drainTouchQueue = function () {
  var g = typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!g || !g.__meltTouchQ) return;
  var q = g.__meltTouchQ;
  while (q.length) {
    var ev = q.shift();
    if (!ev) continue;
    var sx = ev.x;
    var sy = ev.y;
    if (this.pixelRatio > 1 && sx > this.screenW * 1.2) {
      sx = sx / this.pixelRatio;
      sy = sy / this.pixelRatio;
    }
    if (g.__meltTouchStat) {
      this._debugTouch = {
        x: Math.round(sx),
        y: Math.round(sy),
        mode: (ev.type || '?') + (ev.ok ? '' : '!'),
      };
    }
    if (ev.type === 'start') this._onTouchStart(sx, sy);
    else if (ev.type === 'move') this._onTouchMove(sx, sy);
    else if (ev.type === 'end') {
      if (this.pointerMode === 'aiming') this._onTouchMove(sx, sy);
      this._onTouchEnd();
    } else if (ev.type === 'cancel') {
      this.pointerMode = 'cancelled';
      this.aiming = false;
    }
  }
  if (g.__meltTouchStat && g.__meltTouchStat.last) {
    // 附带全局计数，确认入口层是否收到事件
    var st = g.__meltTouchStat;
    if (!this._debugTouch) this._debugTouch = { x: 0, y: 0, mode: 'idle' };
    this._debugTouch.mode = (this._debugTouch.mode || 'idle') + ' #' + st.n;
  }
};

Game.prototype._touchXY = function (e, fromChanged) {
  var list = fromChanged
    ? e.changedTouches || e.touches
    : e.touches || e.changedTouches;
  var t = list && list[0];
  // 也可能是鼠标事件本身（无 touches）
  if (!t && e && (e.x != null || e.clientX != null)) t = e;
  if (!t) return null;
  var x = t.x != null ? t.x : t.clientX;
  var y = t.y != null ? t.y : t.clientY;
  if (x == null || y == null) return null;
  // 若坐标像物理像素，缩回 CSS 像素
  if (this.pixelRatio > 1 && x > this.screenW * 1.2) {
    x = x / this.pixelRatio;
    y = y / this.pixelRatio;
  }
  return { x: x, y: y };
};

Game.prototype._recordDebugTouch = function (sx, sy, mode) {
  this._debugTouch = {
    x: Math.round(sx || 0),
    y: Math.round(sy || 0),
    mode: mode || this.pointerMode || 'idle',
  };
};

Game.prototype._nudgeAim = function (dir) {
  if (this.gameOver || !this.canDrop) return;
  var step = 28;
  this.aimX = this._clampAimX(this.aimX + dir * step);
};

Game.prototype._bindTouch = function () {
  var self = this;

  function onStart(e) {
    var p = self._touchXY(e, false);
    if (!p) return;
    self._onTouchStart(p.x, p.y);
  }
  function onMove(e) {
    var p = self._touchXY(e, false);
    if (!p) return;
    self._onTouchMove(p.x, p.y);
  }
  function onEnd(e) {
    // end 时用 changedTouches 更新最后瞄准点
    var p = self._touchXY(e, true);
    if (p && self.pointerMode === 'aiming') {
      self._onTouchMove(p.x, p.y);
    }
    self._onTouchEnd();
  }
  function onCancel() {
    self.pointerMode = 'cancelled';
    self.aiming = false;
  }

  if (typeof wx !== 'undefined') {
    if (wx.onTouchStart) wx.onTouchStart(onStart);
    if (wx.onTouchMove) wx.onTouchMove(onMove);
    if (wx.onTouchEnd) wx.onTouchEnd(onEnd);
    if (wx.onTouchCancel) wx.onTouchCancel(onCancel);
  }

  // 部分运行时也挂在 canvas 上（含开发者工具鼠标）
  var c = this.canvas;
  if (c && typeof c.addEventListener === 'function') {
    c.addEventListener('touchstart', onStart, false);
    c.addEventListener('touchmove', onMove, false);
    c.addEventListener('touchend', onEnd, false);
    c.addEventListener('touchcancel', onCancel, false);
    function mouseXY(ev) {
      var x = ev.clientX != null ? ev.clientX : ev.x;
      var y = ev.clientY != null ? ev.clientY : ev.y;
      if (x == null || y == null) return null;
      if (self.pixelRatio > 1 && x > self.screenW * 1.2) {
        x = x / self.pixelRatio;
        y = y / self.pixelRatio;
      }
      return { x: x, y: y };
    }
    c.addEventListener(
      'mousedown',
      function (ev) {
        var p = mouseXY(ev);
        if (p) self._onTouchStart(p.x, p.y);
      },
      false
    );
    c.addEventListener(
      'mousemove',
      function (ev) {
        if (self.pointerMode !== 'aiming') return;
        var p = mouseXY(ev);
        if (p) self._onTouchMove(p.x, p.y);
      },
      false
    );
    c.addEventListener(
      'mouseup',
      function (ev) {
        var p = mouseXY(ev);
        if (p && self.pointerMode === 'aiming') {
          self._onTouchMove(p.x, p.y);
        }
        self._onTouchEnd();
      },
      false
    );
  }
};

Game.prototype._hitRect = function (r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
};

/** 屏幕坐标是否在可操作投放区（HUD 下方即可，不要求精确落在逻辑矩形内） */
Game.prototype._inDropZone = function (sx, sy) {
  return sy >= (this.HUD_H || 0) - 4 && sy <= this.screenH && sx >= 0 && sx <= this.screenW;
};

Game.prototype._onTouchStart = function (sx, sy) {
  this._recordDebugTouch(sx, sy, this.pointerMode);

  if (this.gameOver && this._hitRect(this.hitOverlayRestart, sx, sy)) {
    this._restart();
    this._recordDebugTouch(sx, sy, 'idle');
    return;
  }
  if (this._hitRect(this.hitRestart, sx, sy)) {
    this._restart();
    this._recordDebugTouch(sx, sy, 'idle');
    return;
  }
  if (this.hitDrop.w > 0 && this._hitRect(this.hitDrop, sx, sy)) {
    if (!this.gameOver && this.canDrop) {
      this._dropFruit();
    }
    this.pointerMode = 'idle';
    this.aiming = false;
    this._recordDebugTouch(sx, sy, 'idle');
    return;
  }
  if (this._hitRect(this.hitSoft, sx, sy)) {
    this._recordDebugTouch(sx, sy, 'idle');
    return;
  }
  if (this.hitNudgeL.w > 0 && this._hitRect(this.hitNudgeL, sx, sy)) {
    this._nudgeAim(-1);
    this._recordDebugTouch(sx, sy, 'idle');
    return;
  }
  if (this.hitNudgeR.w > 0 && this._hitRect(this.hitNudgeR, sx, sy)) {
    this._nudgeAim(1);
    this._recordDebugTouch(sx, sy, 'idle');
    return;
  }

  if (this.gameOver || !this.canDrop) {
    this._recordDebugTouch(sx, sy, 'idle');
    return;
  }

  // 非按钮区（含 HUD 空隙与玩法区）：开始瞄准；x→aimX
  var p = this._toLogical(sx, sy);
  this.pointerMode = 'aiming';
  this.aiming = true;
  this.aimX = this._clampAimX(p.x);
  this._recordDebugTouch(sx, sy, 'aiming');
};

Game.prototype._onTouchMove = function (sx, sy) {
  this._recordDebugTouch(sx, sy, this.pointerMode);
  if (this.pointerMode !== 'aiming' || this.gameOver) return;
  // 仅明确命中 soft/restart 才取消；其余继续更新 aimX
  if (this._hitRect(this.hitRestart, sx, sy) || this._hitRect(this.hitSoft, sx, sy)) {
    this.pointerMode = 'cancelled';
    this.aiming = false;
    this._recordDebugTouch(sx, sy, 'cancelled');
    return;
  }
  var p = this._toLogical(sx, sy);
  this.aimX = this._clampAimX(p.x);
  this._recordDebugTouch(sx, sy, 'aiming');
};

Game.prototype._onTouchEnd = function () {
  // 瞄准中松手一律投放
  if (this.pointerMode === 'aiming' && !this.gameOver && this.canDrop) {
    this._dropFruit();
  }
  this.pointerMode = 'idle';
  this.aiming = false;
  if (this._debugTouch) this._debugTouch.mode = 'idle';
};

Game.prototype._dropFruit = function () {
  if (!this.canDrop || this.gameOver) return;
  this.canDrop = false;
  this.scoreMgr.resetChain();

  var x = this._clampAimX(this.aimX);
  var body = createFruitBody(x, DROP_Y, this.pendingLevel);
  Matter.Body.setVelocity(body, { x: 0, y: 4 });
  Matter.World.add(this.engine.world, body);

  this.pendingLevel = this.nextLevel;
  this.nextLevel = randomDropLevel();

  // 立刻刷新一帧，避免循环未跑时看起来“点了没反应”
  try {
    this._render();
  } catch (e) {}

  var self = this;
  setTimeout(function () {
    if (!self.gameOver) self.canDrop = true;
  }, DROP_COOLDOWN_MS);
};

Game.prototype._restart = function () {
  this.gameOver = false;
  this.canDrop = true;
  this.aiming = false;
  this.pointerMode = 'idle';
  this.floatTexts = [];
  this.energy = ENERGY_DEFAULT;
  this.scoreMgr.reset();
  this.physAccum.value = 0;

  var fruitBodies = this.engine.world.bodies.filter(isFruitBody);
  Matter.World.remove(this.engine.world, fruitBodies);

  this.pendingLevel = randomDropLevel();
  this.nextLevel = randomDropLevel();
};

Game.prototype._update = function (dt) {
  this._drainTouchQueue();

  fixedStep(this.engine, dt, this.physAccum);

  var bodies = this.engine.world.bodies;
  for (var i = 0; i < bodies.length; i++) {
    if (isFruitBody(bodies[i])) updateJelly(bodies[i]);
  }

  for (var j = 0; j < this.floatTexts.length; j++) {
    this.floatTexts[j].life -= dt;
    this.floatTexts[j].y -= dt * 0.04;
  }
  this.floatTexts = this.floatTexts.filter(function (f) {
    return f.life > 0;
  });

  if (!this.gameOver) this._checkFailLine();
};

Game.prototype._checkFailLine = function () {
  var now = nowMs();
  var bodies = this.engine.world.bodies;
  for (var i = 0; i < bodies.length; i++) {
    var body = bodies[i];
    var data = getFruitData(body);
    if (!data) continue;

    var settled =
      body.isSleeping ||
      (Math.abs(body.velocity.x) < 0.15 &&
        Math.abs(body.velocity.y) < 0.15 &&
        Math.abs(body.angularVelocity) < 0.05);

    var above = body.position.y < FAIL_LINE_Y;

    if (above && settled) {
      if (data.settledAtAbove == null) {
        data.settledAtAbove = now;
      } else if (now - data.settledAtAbove >= FAIL_HOLD_MS) {
        this._triggerGameOver();
        return;
      }
    } else {
      data.settledAtAbove = null;
    }
  }
};

Game.prototype._triggerGameOver = function () {
  if (this.gameOver) return;
  this.gameOver = true;
  this.canDrop = false;
  this.aiming = false;
};

Game.prototype._render = function () {
  var ctx = this.ctx;
  var dpr = this.pixelRatio;
  var sw = this.screenW;
  var sh = this.screenH;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, sw, sh);

  ctx.fillStyle = '#fff0e8';
  ctx.fillRect(0, 0, sw, sh);

  this._drawHUD(ctx);
  this._drawPlayfield(ctx);

  if (this.gameOver) {
    this._drawGameOverOverlay(ctx);
  }
};

Game.prototype._drawHUD = function (ctx) {
  var sw = this.screenW;
  var hudH = this.HUD_H;
  var topPad = this.topPad;
  var mb = this.menuButton;

  ctx.fillStyle = 'rgba(255, 248, 242, 0.96)';
  ctx.fillRect(0, 0, sw, hudH);
  ctx.strokeStyle = 'rgba(255, 150, 110, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, hudH - 0.5);
  ctx.lineTo(sw, hudH - 0.5);
  ctx.stroke();

  var score = this.scoreMgr.score;
  var high = this.scoreMgr.highScore;
  var pad = 14;
  var labelY = topPad;
  var valueY = topPad + 18;

  // Scores left-aligned; energy must not run under capsule
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#9a6b4f';
  ctx.font = '12px sans-serif';
  ctx.fillText('得分', pad, labelY);
  ctx.fillText('最高', pad + 86, labelY);

  var energyLabel = '能量';
  var energyX = pad + 172;
  // Keep energy column left of capsule
  if (mb && energyX + 48 > mb.left - 8) {
    energyX = Math.max(pad + 160, mb.left - 56);
  }
  if (!mb || energyX + 40 < mb.left - 8) {
    ctx.fillText(energyLabel, energyX, labelY);
  }

  ctx.fillStyle = '#5a3d2b';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(String(score), pad, valueY);
  ctx.fillText(String(high), pad + 86, valueY);
  if (!mb || energyX + 40 < mb.left - 8) {
    ctx.fillText(String(this.energy), energyX, valueY);
  }

  // Next preview
  var np = this.nextPreview;
  ctx.fillStyle = '#9a6b4f';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('下一个', np.x, np.y - np.r - 2);
  var def = getFruit(this.nextLevel);
  var previewScale = Math.min(1, np.r / def.radius);
  drawFruit(ctx, np.x, np.y, def, previewScale, this.fruitImages);

  if (this.hitNudgeL.w > 0) {
    this._drawButton(ctx, this.hitNudgeL, '◀', false);
    this._drawButton(ctx, this.hitNudgeR, '▶', false);
  }
  this._drawButton(ctx, this.hitSoft, '揉软一下', true);
  this._drawPrimaryButton(ctx, this.hitDrop, '投放');
  this._drawButton(ctx, this.hitRestart, '重新开始', false);

  // Debug: last touch
  var dbg = this._debugTouch || { x: 0, y: 0, mode: 'idle' };
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(120, 90, 70, 0.55)';
  ctx.font = '10px sans-serif';
  var g = typeof GameGlobal !== 'undefined' ? GameGlobal : null;
  var bridge = g && g.__meltTouchStat ? (' | ' + g.__meltTouchStat.last + ' n=' + g.__meltTouchStat.n) : '';
  ctx.fillText(
    'touch:' + dbg.x + ',' + dbg.y + ' mode:' + (dbg.mode || 'idle') + bridge,
    10,
    hudH - 14
  );
};

Game.prototype._drawPrimaryButton = function (ctx, r, label) {
  var radius = 8;
  ctx.beginPath();
  this._roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = '#2ecc71';
  ctx.fill();
  ctx.strokeStyle = '#27ae60';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
};

Game.prototype._drawButton = function (ctx, r, label, disabled) {
  var radius = 8;
  ctx.beginPath();
  this._roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  if (disabled) {
    ctx.fillStyle = '#e8ddd4';
    ctx.fill();
    ctx.strokeStyle = '#cbb8a8';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#a89080';
  } else {
    ctx.fillStyle = '#ff7b54';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
  }
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
};

Game.prototype._drawPlayfield = function (ctx) {
  var images = this.fruitImages;
  ctx.save();
  ctx.translate(this.playOffsetX, this.playOffsetY);
  ctx.scale(this.playScale, this.playScale);

  var bg = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
  bg.addColorStop(0, '#fff8f2');
  bg.addColorStop(1, '#ffe4d4');
  ctx.fillStyle = bg;
  this._roundRectPath(ctx, 0, 0, LOGICAL_W, LOGICAL_H, 16);
  ctx.fill();

  ctx.strokeStyle = 'rgba(230, 60, 50, 0.85)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(12, FAIL_LINE_Y);
  ctx.lineTo(LOGICAL_W - 12, FAIL_LINE_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(230, 60, 50, 0.7)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('危险线', 14, FAIL_LINE_Y - 6);

  if (this.aiming && this.canDrop && !this.gameOver) {
    var defAim = getFruit(this.pendingLevel);
    var ax = this._clampAimX(this.aimX);
    ctx.strokeStyle = 'rgba(120, 80, 60, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, DROP_Y + defAim.radius);
    ctx.lineTo(ax, LOGICAL_H - 8);
    ctx.stroke();
    ctx.setLineDash([]);
    drawFruit(ctx, ax, DROP_Y, defAim, 1, images);
  } else if (this.canDrop && !this.gameOver) {
    var defPend = getFruit(this.pendingLevel);
    drawFruit(ctx, this.aimX, DROP_Y, defPend, 1, images);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#5a3d2b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('拖动或点「投放」', LOGICAL_W / 2, DROP_Y - defPend.radius - 8);
    ctx.globalAlpha = 1;
  }

  var bodies = this.engine.world.bodies;
  for (var i = 0; i < bodies.length; i++) {
    var body = bodies[i];
    var data = getFruitData(body);
    if (!data) continue;
    var def = getFruit(data.level);
    var j = data.jelly || { sx: 1, sy: 1 };
    drawFruit(ctx, body.position.x, body.position.y, def, 1, images, {
      sx: j.sx,
      sy: j.sy,
      angle: body.angle,
    });
  }

  for (var k = 0; k < this.floatTexts.length; k++) {
    var ft = this.floatTexts[k];
    ctx.globalAlpha = Math.max(0, ft.life / 700);
    ctx.fillStyle = '#e85d04';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = 'rgba(255, 150, 110, 0.55)';
  ctx.lineWidth = 3;
  this._roundRectPath(ctx, 1.5, 1.5, LOGICAL_W - 3, LOGICAL_H - 3, 15);
  ctx.stroke();

  ctx.restore();
};

Game.prototype._drawGameOverOverlay = function (ctx) {
  var sw = this.screenW;
  var sh = this.screenH;
  ctx.fillStyle = 'rgba(40, 20, 10, 0.45)';
  ctx.fillRect(0, 0, sw, sh);

  var cardW = Math.min(300, sw - 40);
  var cardH = 200;
  var cx = (sw - cardW) / 2;
  var cy = (sh - cardH) / 2;

  ctx.fillStyle = '#fff8f2';
  this._roundRectPath(ctx, cx, cy, cardW, cardH, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 150, 110, 0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#5a3d2b';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('游戏结束', sw / 2, cy + 36);

  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#7a5a45';
  ctx.fillText('本次得分：' + this.scoreMgr.score, sw / 2, cy + 78);
  ctx.fillText('最高纪录：' + this.scoreMgr.highScore, sw / 2, cy + 104);

  var btnW = 140;
  var btnH = 40;
  this.hitOverlayRestart = {
    x: (sw - btnW) / 2,
    y: cy + cardH - 56,
    w: btnW,
    h: btnH,
  };
  this._drawButton(ctx, this.hitOverlayRestart, '再来一局', false);
};

Game.prototype._toLogical = function (sx, sy) {
  return {
    x: (sx - this.playOffsetX) / this.playScale,
    y: (sy - this.playOffsetY) / this.playScale,
  };
};

Game.prototype._inPlayfield = function (x, y) {
  return x >= 0 && x <= LOGICAL_W && y >= 0 && y <= LOGICAL_H;
};

Game.prototype._clampAimX = function (x) {
  var r = getFruit(this.pendingLevel).radius;
  return Math.max(r + 2, Math.min(LOGICAL_W - r - 2, x));
};

Game.prototype._roundRectPath = function (ctx, x, y, w, h, r) {
  // 避免 arcTo：部分微信 Canvas 2D 不支持
  var rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
};

module.exports = Game;
