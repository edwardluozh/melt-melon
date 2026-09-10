/**
 * 同级水果碰撞合成
 */
var Matter = require('./matter.min.js');
var fruits = require('./fruits.js');
var physics = require('./physics.js');

function attachMergeHandler(engine, onMerge, isActive) {
  var processing = {};

  function onCollision(event) {
    if (!isActive()) return;

    var pairs = event.pairs;
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      var a = pair.bodyA;
      var b = pair.bodyB;
      if (!physics.isFruitBody(a) || !physics.isFruitBody(b)) continue;
      if (processing[a.id] || processing[b.id]) continue;

      var da = physics.getFruitData(a);
      var db = physics.getFruitData(b);
      if (da.level !== db.level) continue;

      var next = fruits.nextLevel(da.level);
      if (next === null) continue;

      processing[a.id] = true;
      processing[b.id] = true;

      var midX = (a.position.x + b.position.x) / 2;
      var midY = (a.position.y + b.position.y) / 2;
      var fromLevel = da.level;
      var baseScore = fruits.getFruit(next).score;

      Matter.World.remove(engine.world, a);
      Matter.World.remove(engine.world, b);

      var spawned = physics.createFruitBody(midX, midY, next);
      Matter.Body.setVelocity(spawned, {
        x: (a.velocity.x + b.velocity.x) * 0.25,
        y: Math.min(0, (a.velocity.y + b.velocity.y) * 0.25) - 1.5,
      });
      Matter.World.add(engine.world, spawned);

      onMerge(baseScore, fromLevel, midX, midY);

      (function (idA, idB) {
        setTimeout(function () {
          delete processing[idA];
          delete processing[idB];
        }, 80);
      })(a.id, b.id);
    }
  }

  Matter.Events.on(engine, 'collisionStart', onCollision);

  return {
    processing: processing,
    detach: function () {
      Matter.Events.off(engine, 'collisionStart', onCollision);
      processing = {};
    },
  };
}

module.exports = {
  attachMergeHandler: attachMergeHandler,
};
