/**
 * Matter.js 引擎与墙体 / 水果刚体（Q 弹）
 */
var Matter = require('./matter.min.js');
var fruits = require('./fruits.js');
var getFruit = fruits.getFruit;

var LOGICAL_W = 375;
var LOGICAL_H = 667;
var WALL_THICKNESS = 40;
var FAIL_LINE_Y = 90;
var DROP_Y = 52;

var FIXED_DT = 1000 / 60;
var MAX_SUBSTEPS = 3;

/** Jelly spring toward identity (lower = slower, more visible Q bounce) */
var JELLY_SPRING_K = 0.075;
/** Velocity damping — leaves light overshoot past 1.0 */
var JELLY_DAMP = 0.82;

function createEngine() {
  var engine = Matter.Engine.create({
    // 稍软重力，弹跳可读性更好
    gravity: { x: 0, y: 0.92, scale: 0.001 },
  });
  engine.enableSleeping = true;
  return engine;
}

function createWalls(world) {
  var t = WALL_THICKNESS;
  var w = LOGICAL_W;
  var h = LOGICAL_H;
  var opts = {
    isStatic: true,
    friction: 0.25,
    restitution: 0.2,
    label: 'wall',
  };
  var left = Matter.Bodies.rectangle(-t / 2, h / 2, t, h + t * 2, opts);
  var right = Matter.Bodies.rectangle(w + t / 2, h / 2, t, h + t * 2, opts);
  var bottom = Matter.Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, opts);
  Matter.World.add(world, [left, right, bottom]);
  return [left, right, bottom];
}

function createFruitBody(x, y, level, options) {
  options = options || {};
  var def = getFruit(level);
  var body = Matter.Bodies.circle(x, y, def.radius, {
    isStatic: options.isStatic || false,
    restitution: 0.6,
    friction: 0.2,
    frictionAir: 0.012,
    density: 0.002 + level * 0.00012,
    sleepThreshold: 35,
    label: 'fruit-' + level,
  });
  body.plugin = {
    kind: 'fruit',
    level: level,
    settledAtAbove: null,
    jelly: { sx: 1, sy: 1, vx: 0, vy: 0 },
  };
  return body;
}

/**
 * Apply visual squash/stretch along collision normal.
 * @param {Matter.Body} body
 * @param {{x:number,y:number}} normal world-space unit normal (impact direction into body)
 * @param {number} speed relative impact speed
 */
function applyJellySquash(body, normal, speed) {
  var data = getFruitData(body);
  if (!data || !data.jelly) return;
  var mag = Math.sqrt(normal.x * normal.x + normal.y * normal.y) || 1;
  var nx = Math.abs(normal.x / mag);
  var ny = Math.abs(normal.y / mag);
  // Strength from impact speed (clamped) → compress ~0.65–0.8, expand ~1.15–1.35
  var t = Math.max(0, Math.min(1, (speed - 0.5) / 7));
  var compress = 0.8 - t * 0.15;
  var expand = 1.15 + t * 0.2;
  var sx;
  var sy;
  if (nx >= ny) {
    sx = compress;
    sy = expand;
  } else {
    sx = expand;
    sy = compress;
  }
  var cur = data.jelly;
  // Reset spring velocity so the new squash reads clearly
  cur.vx = 0;
  cur.vy = 0;
  if (sx < 1) cur.sx = Math.min(cur.sx, sx);
  else cur.sx = Math.max(cur.sx, sx);
  if (sy < 1) cur.sy = Math.min(cur.sy, sy);
  else cur.sy = Math.max(cur.sy, sy);
}

/** Tiny overall scale pulse (e.g. merge spawn pop). */
function pulseJelly(body, amount) {
  var data = getFruitData(body);
  if (!data || !data.jelly) return;
  var a = amount == null ? 0.12 : amount;
  var j = data.jelly;
  j.sx = Math.min(1.4, j.sx * (1 + a));
  j.sy = Math.min(1.4, j.sy * (1 + a));
  j.vx = 0;
  j.vy = 0;
}

/** Spring jelly scales toward 1 with light overshoot (call each frame). */
function updateJelly(body) {
  var data = getFruitData(body);
  if (!data || !data.jelly) return;
  var j = data.jelly;
  if (j.vx == null) j.vx = 0;
  if (j.vy == null) j.vy = 0;
  var k = JELLY_SPRING_K;
  var damp = JELLY_DAMP;
  j.vx = (j.vx + (1 - j.sx) * k) * damp;
  j.vy = (j.vy + (1 - j.sy) * k) * damp;
  j.sx += j.vx;
  j.sy += j.vy;
  // Soft settle near identity
  if (Math.abs(j.sx - 1) < 0.003 && Math.abs(j.vx) < 0.001) {
    j.sx = 1;
    j.vx = 0;
  }
  if (Math.abs(j.sy - 1) < 0.003 && Math.abs(j.vy) < 0.001) {
    j.sy = 1;
    j.vy = 0;
  }
  // Stability clamps
  j.sx = Math.max(0.55, Math.min(1.45, j.sx));
  j.sy = Math.max(0.55, Math.min(1.45, j.sy));
}

/**
 * Fixed-timestep Engine.update — silences Matter delta warnings and stabilizes bounce.
 * Mutates accumulator object: { value: number }
 */
function fixedStep(engine, dtMs, accumulator) {
  var acc = accumulator.value + dtMs;
  var steps = 0;
  while (acc >= FIXED_DT && steps < MAX_SUBSTEPS) {
    Matter.Engine.update(engine, FIXED_DT);
    acc -= FIXED_DT;
    steps += 1;
  }
  // Drop excess to avoid spiral of death after long stalls
  if (acc > FIXED_DT * 2) acc = 0;
  accumulator.value = acc;
  return steps;
}

function getFruitData(body) {
  var data = body.plugin;
  if (data && data.kind === 'fruit') return data;
  return null;
}

function isFruitBody(body) {
  return getFruitData(body) !== null;
}

function isWallBody(body) {
  return body && body.label === 'wall';
}

function fruitDefOf(body) {
  var data = getFruitData(body);
  return data ? getFruit(data.level) : null;
}

module.exports = {
  LOGICAL_W: LOGICAL_W,
  LOGICAL_H: LOGICAL_H,
  WALL_THICKNESS: WALL_THICKNESS,
  FAIL_LINE_Y: FAIL_LINE_Y,
  DROP_Y: DROP_Y,
  FIXED_DT: FIXED_DT,
  MAX_SUBSTEPS: MAX_SUBSTEPS,
  JELLY_SPRING_K: JELLY_SPRING_K,
  createEngine: createEngine,
  createWalls: createWalls,
  createFruitBody: createFruitBody,
  applyJellySquash: applyJellySquash,
  pulseJelly: pulseJelly,
  updateJelly: updateJelly,
  fixedStep: fixedStep,
  getFruitData: getFruitData,
  isFruitBody: isFruitBody,
  isWallBody: isWallBody,
  fruitDefOf: fruitDefOf,
};
