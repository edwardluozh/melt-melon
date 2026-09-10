/**
 * SoftWorld contact merge — same-level fruits fuse into next level.
 */
var fruits = require('./fruits.js');

/**
 * Process SoftWorld contacts once per frame.
 * @param {object} softWorld
 * @param {(baseScore:number, fromLevel:number, x:number, y:number)=>void} onMerge
 * @param {()=>boolean} isActive
 * @returns {number} merges performed
 */
function processMerges(softWorld, onMerge, isActive) {
  if (!isActive || !isActive()) return 0;
  if (!softWorld || !softWorld.bodies || softWorld.bodies.length < 2) return 0;

  var contacts = softWorld.getContacts();
  if (!contacts || !contacts.length) return 0;

  var used = {};
  var merges = 0;
  var removeIds = [];
  var spawns = [];

  for (var i = 0; i < contacts.length; i++) {
    var pair = contacts[i];
    if (!pair || pair.length < 2) continue;
    var a = pair[0];
    var b = pair[1];
    if (!a || !b) continue;
    if (used[a.id] || used[b.id]) continue;
    if (a.level !== b.level) continue;

    var next = fruits.nextLevel(a.level);
    if (next === null) continue;

    used[a.id] = true;
    used[b.id] = true;
    removeIds.push(a.id, b.id);

    var midX = (a.x + b.x) * 0.5;
    var midY = (a.y + b.y) * 0.5;
    var vx = ((a.vx || 0) + (b.vx || 0)) * 0.25;
    var vy = Math.min(0, ((a.vy || 0) + (b.vy || 0)) * 0.25) - 40;
    var fromLevel = a.level;
    var baseScore = fruits.getFruit(next).score;
    var radius = fruits.getFruit(next).radius;

    spawns.push({
      level: next,
      x: midX,
      y: midY,
      r: radius,
      vx: vx,
      vy: vy,
      fromLevel: fromLevel,
      baseScore: baseScore,
    });
    merges += 1;
  }

  if (!merges) return 0;

  softWorld.remove(removeIds);
  for (var s = 0; s < spawns.length; s++) {
    var sp = spawns[s];
    softWorld.add(sp.level, sp.x, sp.y, sp.r, {
      vx: sp.vx,
      vy: sp.vy,
      growFrom: 0.55,
      growthSeconds: 0.28,
    });
    if (onMerge) onMerge(sp.baseScore, sp.fromLevel, sp.x, sp.y);
  }
  return merges;
}

module.exports = {
  processMerges: processMerges,
};
