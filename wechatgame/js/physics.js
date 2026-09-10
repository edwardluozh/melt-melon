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
    restitution: 0.5,
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
  };
  return body;
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
  createEngine: createEngine,
  createWalls: createWalls,
  createFruitBody: createFruitBody,
  fixedStep: fixedStep,
  getFruitData: getFruitData,
  isFruitBody: isFruitBody,
  fruitDefOf: fruitDefOf,
};
