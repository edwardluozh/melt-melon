/**
 * Matter.js 引擎与墙体 / 水果刚体
 */
var Matter = require('./matter.min.js');
var fruits = require('./fruits.js');
var getFruit = fruits.getFruit;

var LOGICAL_W = 375;
var LOGICAL_H = 667;
var WALL_THICKNESS = 40;
var FAIL_LINE_Y = 90;
var DROP_Y = 52;

function createEngine() {
  var engine = Matter.Engine.create({
    gravity: { x: 0, y: 1.05, scale: 0.001 },
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
    friction: 0.8,
    restitution: 0.05,
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
    restitution: 0.12,
    friction: 0.35,
    frictionAir: 0.01,
    density: 0.002 + level * 0.00015,
    sleepThreshold: 30,
    label: 'fruit-' + level,
  });
  body.plugin = {
    kind: 'fruit',
    level: level,
    settledAtAbove: null,
  };
  return body;
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
  createEngine: createEngine,
  createWalls: createWalls,
  createFruitBody: createFruitBody,
  getFruitData: getFruitData,
  isFruitBody: isFruitBody,
  fruitDefOf: fruitDefOf,
};
