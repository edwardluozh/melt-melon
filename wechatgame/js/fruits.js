/**
 * 水果定义与绘制（与浏览器 M1 一致）
 */

var FRUITS = [
  { level: 0, name: '葡萄', emoji: '🍇', radius: 14, color: '#b57edc', stroke: '#7a4aa8', score: 1 },
  { level: 1, name: '樱桃', emoji: '🍒', radius: 18, color: '#ff6b81', stroke: '#c44569', score: 2 },
  { level: 2, name: '橘子', emoji: '🍊', radius: 22, color: '#ffa502', stroke: '#e67e22', score: 4 },
  { level: 3, name: '柠檬', emoji: '🍋', radius: 26, color: '#f7d060', stroke: '#d4a017', score: 8 },
  { level: 4, name: '猕猴桃', emoji: '🥝', radius: 30, color: '#7bed9f', stroke: '#2ed573', score: 16 },
  { level: 5, name: '番茄', emoji: '🍅', radius: 34, color: '#ff6348', stroke: '#e84118', score: 32 },
  { level: 6, name: '桃', emoji: '🍑', radius: 40, color: '#ff9ff3', stroke: '#f368e0', score: 64 },
  { level: 7, name: '菠萝', emoji: '🍍', radius: 46, color: '#eccc68', stroke: '#cca000', score: 128 },
  { level: 8, name: '椰子', emoji: '🥥', radius: 54, color: '#dfe6e9', stroke: '#b2bec3', score: 256 },
  { level: 9, name: '西瓜', emoji: '🍉', radius: 64, color: '#2ed573', stroke: '#1e9d4b', score: 512 },
];

var DROP_LEVEL_COUNT = 5;

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

function drawFruit(ctx, x, y, def, scale) {
  scale = scale == null ? 1 : scale;
  var r = def.radius * scale;
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

module.exports = {
  FRUITS: FRUITS,
  DROP_LEVEL_COUNT: DROP_LEVEL_COUNT,
  getFruit: getFruit,
  nextLevel: nextLevel,
  randomDropLevel: randomDropLevel,
  drawFruit: drawFruit,
};
