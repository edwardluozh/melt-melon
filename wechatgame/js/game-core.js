/**
 * 软西瓜 M1 — 微信小游戏主逻辑
 * 无 DOM：HUD / 按钮 / 结算层全部画在主 canvas 上
 */
var Matter = require('./matter.min.js');
var fruits = require('./fruits.js');
var physics = require('./physics.js');
var merge = require('./merge.js');
var scoreMod = require('./score.js');

var getFruit = fruits.getFruit;
var drawFruit = fruits.drawFruit;
var randomDropLevel = fruits.randomDropLevel;
var LOGICAL_W = physics.LOGICAL_W;
var LOGICAL_H = physics.LOGICAL_H;
var FAIL_LINE_Y = physics.FAIL_LINE_Y;
var DROP_Y = physics.DROP_Y;
var createEngine = physics.createEngine;
var createWalls = physics.createWalls;
var createFruitBody = physics.createFruitBody;
var getFruitData = physics.getFruitData;
var isFruitBody = physics.isFruitBody;
var attachMergeHandler = merge.attachMergeHandler;
var ScoreManager = scoreMod.ScoreManager;

var DROP_COOLDOWN_MS = 450;
var FAIL_HOLD_MS = 3000;
var HUD_H = 112;
var ENERGY_DEFAULT = 100;

function nowMs() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

function Game() {
  var sys = wx.getSystemInfoSync();
  this.pixelRatio = sys.pixelRatio || 2;
  this.screenW = sys.windowWidth;
  this.screenH = sys.windowHeight;

  this.canvas = wx.createCanvas();
  this.ctx = this.canvas.getContext('2d');
  this.canvas.width = Math.floor(this.screenW * this.pixelRatio);
  this.canvas.height = Math.floor(this.screenH * this.pixelRatio);

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

  // 布局：顶部 HUD + 下方游戏区 letterbox
  this.playScale = 1;
  this.playOffsetX = 0;
  this.playOffsetY = HUD_H;
  this.hitSoft = { x: 0, y: 0, w: 0, h: 0 };
  this.hitRestart = { x: 0, y: 0, w: 0, h: 0 };
  this.hitOverlayRestart = { x: 0, y: 0, w: 0, h: 0 };

  this._layout();
  this._bindMerge();
  this._bindTouch();
}

Game.prototype.start = function () {
  if (this.running) return;
  this.running = true;
  this.lastTs = nowMs();
  var self = this;
  function loop(ts) {
    if (!self.running) return;
    var t = typeof ts === 'number' ? ts : nowMs();
    var dt = Math.min(32, t - self.lastTs);
    self.lastTs = t;
    self._update(dt);
    self._render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
};

Game.prototype._layout = function () {
  var availW = this.screenW;
  var availH = Math.max(80, this.screenH - HUD_H);
  var fit = Math.min(availW / LOGICAL_W, availH / LOGICAL_H);
  this.playScale = fit;
  this.playOffsetX = (availW - LOGICAL_W * fit) / 2;
  this.playOffsetY = HUD_H + (availH - LOGICAL_H * fit) / 2;

  // HUD 按钮命中区（屏幕坐标）
  var pad = 10;
  var btnH = 32;
  var softW = 88;
  var restartW = 88;
  var right = this.screenW - pad;
  this.hitRestart = {
    x: right - restartW,
    y: 68,
    w: restartW,
    h: btnH,
  };
  this.hitSoft = {
    x: this.hitRestart.x - softW - 8,
    y: 68,
    w: softW,
    h: btnH,
  };
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

Game.prototype._bindTouch = function () {
  var self = this;

  wx.onTouchStart(function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    var x = t.clientX != null ? t.clientX : t.x;
    var y = t.clientY != null ? t.clientY : t.y;
    self._onTouchStart(x, y);
  });

  wx.onTouchMove(function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    var x = t.clientX != null ? t.clientX : t.x;
    var y = t.clientY != null ? t.clientY : t.y;
    self._onTouchMove(x, y);
  });

  wx.onTouchEnd(function () {
    self._onTouchEnd();
  });

  wx.onTouchCancel(function () {
    self.pointerMode = 'cancelled';
    self.aiming = false;
  });
};

Game.prototype._hitRect = function (r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
};

Game.prototype._onTouchStart = function (sx, sy) {
  // 结算层「再来一局」
  if (this.gameOver && this._hitRect(this.hitOverlayRestart, sx, sy)) {
    this._restart();
    return;
  }
  // HUD 重新开始
  if (this._hitRect(this.hitRestart, sx, sy)) {
    this._restart();
    return;
  }
  // 揉软一下：M2 占位，禁用
  if (this._hitRect(this.hitSoft, sx, sy)) {
    return;
  }

  if (this.gameOver || !this.canDrop) return;
  var p = this._toLogical(sx, sy);
  if (!this._inPlayfield(p.x, p.y)) return;
  this.pointerMode = 'aiming';
  this.aiming = true;
  this.aimX = this._clampAimX(p.x);
};

Game.prototype._onTouchMove = function (sx, sy) {
  if (this.pointerMode !== 'aiming' || this.gameOver) return;
  var p = this._toLogical(sx, sy);
  if (!this._inPlayfield(p.x, p.y)) {
    this.pointerMode = 'cancelled';
    this.aiming = false;
    return;
  }
  this.aimX = this._clampAimX(p.x);
};

Game.prototype._onTouchEnd = function () {
  if (this.pointerMode === 'aiming' && !this.gameOver && this.canDrop) {
    this._dropFruit();
  }
  this.pointerMode = 'idle';
  this.aiming = false;
};

Game.prototype._dropFruit = function () {
  if (!this.canDrop || this.gameOver) return;
  this.canDrop = false;
  this.scoreMgr.resetChain();

  var x = this._clampAimX(this.aimX);
  var body = createFruitBody(x, DROP_Y, this.pendingLevel);
  Matter.Body.setVelocity(body, { x: 0, y: 2 });
  Matter.World.add(this.engine.world, body);

  this.pendingLevel = this.nextLevel;
  this.nextLevel = randomDropLevel();

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

  var fruitBodies = this.engine.world.bodies.filter(isFruitBody);
  Matter.World.remove(this.engine.world, fruitBodies);

  this.pendingLevel = randomDropLevel();
  this.nextLevel = randomDropLevel();
};

Game.prototype._update = function (dt) {
  Matter.Engine.update(this.engine, dt);

  for (var i = 0; i < this.floatTexts.length; i++) {
    this.floatTexts[i].life -= dt;
    this.floatTexts[i].y -= dt * 0.04;
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

  // 全屏底色
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
  // HUD 背景
  ctx.fillStyle = 'rgba(255, 248, 242, 0.96)';
  ctx.fillRect(0, 0, sw, HUD_H);
  ctx.strokeStyle = 'rgba(255, 150, 110, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HUD_H - 0.5);
  ctx.lineTo(sw, HUD_H - 0.5);
  ctx.stroke();

  var score = this.scoreMgr.score;
  var high = this.scoreMgr.highScore;
  var pad = 12;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#9a6b4f';
  ctx.font = '11px sans-serif';
  ctx.fillText('得分', pad, 10);
  ctx.fillText('最高', pad + 78, 10);
  ctx.fillText('能量', pad + 156, 10);

  ctx.fillStyle = '#5a3d2b';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(String(score), pad, 26);
  ctx.fillText(String(high), pad + 78, 26);
  ctx.fillText(String(this.energy), pad + 156, 26);

  // 下一个预览
  var nextX = sw - 56;
  var nextY = 8;
  ctx.fillStyle = '#9a6b4f';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('下一个', nextX, nextY);
  var def = getFruit(this.nextLevel);
  var previewScale = Math.min(1, 18 / def.radius);
  drawFruit(ctx, nextX, nextY + 38, def, previewScale);

  // 按钮
  this._drawButton(ctx, this.hitSoft, '揉软一下', true);
  this._drawButton(ctx, this.hitRestart, '重新开始', false);
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
  ctx.save();
  ctx.translate(this.playOffsetX, this.playOffsetY);
  ctx.scale(this.playScale, this.playScale);

  // 背景
  var bg = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
  bg.addColorStop(0, '#fff8f2');
  bg.addColorStop(1, '#ffe4d4');
  ctx.fillStyle = bg;
  this._roundRectPath(ctx, 0, 0, LOGICAL_W, LOGICAL_H, 16);
  ctx.fill();

  // 红线
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

  // 瞄准 / 待投放
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
    drawFruit(ctx, ax, DROP_Y, defAim, 1);
  } else if (this.canDrop && !this.gameOver) {
    var defPend = getFruit(this.pendingLevel);
    drawFruit(ctx, this.aimX, DROP_Y, defPend, 1);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#5a3d2b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('拖动瞄准，松手投放', LOGICAL_W / 2, DROP_Y - defPend.radius - 8);
    ctx.globalAlpha = 1;
  }

  // 水果
  var bodies = this.engine.world.bodies;
  for (var i = 0; i < bodies.length; i++) {
    var body = bodies[i];
    var data = getFruitData(body);
    if (!data) continue;
    var def = getFruit(data.level);
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    drawFruit(ctx, 0, 0, def, 1);
    ctx.restore();
  }

  // 飘分
  for (var j = 0; j < this.floatTexts.length; j++) {
    var ft = this.floatTexts[j];
    ctx.globalAlpha = Math.max(0, ft.life / 700);
    ctx.fillStyle = '#e85d04';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }

  // 边框
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
  var rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

module.exports = Game;
