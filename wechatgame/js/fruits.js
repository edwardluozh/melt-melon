/**
 * 水果定义与绘制（8 阶精灵）
 */

var FRUITS = [
  { level: 0, name: '葡萄', emoji: '🍇', radius: 16, color: '#b57edc', stroke: '#7a4aa8', score: 1, sprite: 'images/fruit_0.png' },
  { level: 1, name: '苹果', emoji: '🍎', radius: 22, color: '#ff6b81', stroke: '#c44569', score: 2, sprite: 'images/fruit_1.png' },
  { level: 2, name: '橘子', emoji: '🍊', radius: 28, color: '#ffa502', stroke: '#e67e22', score: 4, sprite: 'images/fruit_2.png' },
  { level: 3, name: '柠檬', emoji: '🍋', radius: 34, color: '#f7d060', stroke: '#d4a017', score: 8, sprite: 'images/fruit_3.png' },
  { level: 4, name: '猕猴桃', emoji: '🥝', radius: 42, color: '#7bed9f', stroke: '#2ed573', score: 16, sprite: 'images/fruit_4.png' },
  { level: 5, name: '桃', emoji: '🍑', radius: 50, color: '#ff9ff3', stroke: '#f368e0', score: 32, sprite: 'images/fruit_5.png' },
  { level: 6, name: '西瓜圆', emoji: '🍉', radius: 60, color: '#2ed573', stroke: '#1e9d4b', score: 64, sprite: 'images/fruit_6.png' },
  { level: 7, name: '西瓜角', emoji: '🍉', radius: 72, color: '#ff4757', stroke: '#c0392b', score: 128, sprite: 'images/fruit_7.png' },
];

var DROP_LEVEL_COUNT = 4;

function getFruit(level) {
  return FRUITS[Math.max(0, Math.min(level, FRUITS.length - 1))];
}

function nextLevel(level) {
  if (level >= FRUITS.length - 1) return null;
  return level + 1;
}

function randomDropLevel() {
  return Math.floor(Math.random() * DROP_LEVEL_COUNT);
}

/**
 * Draw fruit at (x,y). Optional xform: { sx, sy, angle } for jelly + rotation.
 * When xform provided, draws centered at origin after translate/rotate/scale.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {object} def
 * @param {number} [scale]
 * @param {Object.<string, Image>} [images]
 * @param {{sx?:number,sy?:number,angle?:number}} [xform]
 */
function drawFruit(ctx, x, y, def, scale, images, xform) {
  scale = scale == null ? 1 : scale;
  var sx = (xform && xform.sx != null) ? xform.sx : 1;
  var sy = (xform && xform.sy != null) ? xform.sy : 1;
  var angle = (xform && xform.angle != null) ? xform.angle : 0;
  var useXform = xform && (sx !== 1 || sy !== 1 || angle !== 0);

  if (useXform) {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.scale(sx, sy);
    _drawFruitAtOrigin(ctx, def, scale, images);
    ctx.restore();
    return;
  }

  _drawFruitCentered(ctx, x, y, def, scale, images);
}

/** Jelly-aware draw helper (explicit API). */
function drawFruitJelly(ctx, x, y, def, scale, images, sx, sy, angle) {
  drawFruit(ctx, x, y, def, scale, images, {
    sx: sx == null ? 1 : sx,
    sy: sy == null ? 1 : sy,
    angle: angle || 0,
  });
}

function _drawFruitAtOrigin(ctx, def, scale, images) {
  _drawFruitCentered(ctx, 0, 0, def, scale, images);
}

function _drawFruitCentered(ctx, x, y, def, scale, images) {
  var r = def.radius * scale;
  var img = images && def.sprite ? images[def.sprite] : null;

  if (img && img.width > 0 && img.height > 0) {
    var size = r * 2;
    ctx.drawImage(img, x - r, y - r, size, size);
    return;
  }

  // fallback circle + emoji
  var grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  grd.addColorStop(0, '#ffffffcc');
  grd.addColorStop(0.35, def.color);
  grd.addColorStop(1, def.stroke);

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.06);
  ctx.strokeStyle = def.stroke;
  ctx.stroke();

  var fontSize = Math.max(10, r * 0.9);
  ctx.font = fontSize + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.emoji, x, y + 1);
}

/**
 * Preload fruit sprites via wx.createImage (or HTML Image fallback).
 * Calls onDone(map) when all settle (loaded or errored).
 */
function preloadFruitImages(onDone) {
  var map = {};
  var left = FRUITS.length;
  if (left === 0) {
    if (onDone) onDone(map);
    return map;
  }

  function settle() {
    left -= 1;
    if (left <= 0 && onDone) onDone(map);
  }

  for (var i = 0; i < FRUITS.length; i++) {
    (function (def) {
      var path = def.sprite;
      var img;
      try {
        if (typeof wx !== 'undefined' && wx.createImage) {
          img = wx.createImage();
        } else if (typeof Image !== 'undefined') {
          img = new Image();
        }
      } catch (e) {
        img = null;
      }
      if (!img) {
        settle();
        return;
      }
      img.onload = function () {
        map[path] = img;
        settle();
      };
      img.onerror = function () {
        settle();
      };
      img.src = path;
    })(FRUITS[i]);
  }
  return map;
}

module.exports = {
  FRUITS: FRUITS,
  DROP_LEVEL_COUNT: DROP_LEVEL_COUNT,
  getFruit: getFruit,
  nextLevel: nextLevel,
  randomDropLevel: randomDropLevel,
  drawFruit: drawFruit,
  drawFruitJelly: drawFruitJelly,
  preloadFruitImages: preloadFruitImages,
};
