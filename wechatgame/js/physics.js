/**
 * SoftWorld playfield constants + factory (no Matter.js).
 */
var softWorldMod = require('./soft-world.js');

var LOGICAL_W = 375;
var LOGICAL_H = 667;
var WALL_LEFT = 8;
var WALL_RIGHT = 367;
var FLOOR_Y = 655;
var FAIL_LINE_Y = 90;
var DROP_Y = 52;
var MAX_BODIES = 48;

function createSoftWorld() {
  return new softWorldMod.SoftWorld({
    width: LOGICAL_W,
    height: LOGICAL_H,
    left: WALL_LEFT,
    right: WALL_RIGHT,
    floor: FLOOR_Y,
  });
}

module.exports = {
  LOGICAL_W: LOGICAL_W,
  LOGICAL_H: LOGICAL_H,
  WALL_LEFT: WALL_LEFT,
  WALL_RIGHT: WALL_RIGHT,
  FLOOR_Y: FLOOR_Y,
  FAIL_LINE_Y: FAIL_LINE_Y,
  DROP_Y: DROP_Y,
  MAX_BODIES: MAX_BODIES,
  createSoftWorld: createSoftWorld,
  SoftWorld: softWorldMod.SoftWorld,
  POINT_COUNT: softWorldMod.POINT_COUNT,
  clamp: softWorldMod.clamp,
  FIXED_STEP: softWorldMod.FIXED_STEP,
};
