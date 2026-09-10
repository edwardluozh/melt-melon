/**
 * SoftWorld soft-body physics (XPBD membrane) — ported from melt-melon SoftWorld.
 * WeChat-friendly: no optional chaining / nullish coalescing.
 */
var POINT_COUNT = 14;
var POINT_COUNT_MED = 12;
var POINT_COUNT_LOW = 10;
var FIXED_STEP = 1 / 60;
var MAX_SUBSTEPS = 2;
var SOLVER_PASSES = 3;
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Adaptive membrane resolution: keep 14 for few bodies, drop when crowded. */
function choosePointCount(bodyCount) {
  if (bodyCount >= 16) return POINT_COUNT_LOW;
  if (bodyCount >= 8) return POINT_COUNT_MED;
  return POINT_COUNT;
}

class SoftWorld {
  constructor(options) {
    options = options || {};
    var width = options.width != null ? options.width : 460;
    var height = options.height != null ? options.height : 640;
    var left = options.left != null ? options.left : 24;
    var right = options.right != null ? options.right : 436;
    var floor = options.floor != null ? options.floor : 615;
    var parameters = options.parameters || {};
    this.width = width;
    this.height = height;
    this.left = left;
    this.right = right;
    this.floor = floor;
    // Speeds are px/s, gravity is px/s², damping is s⁻¹, frequencies are Hz.
    this.parameters = {
      gravity: 1100, airDrag: 0.06, internalDamping: 1.5, liquidInternalDamping: 5,
      shapeFrequency: 2.9, liquidShapeFrequency: 0.8,
      edgeCompliance: 0.00012, bendCompliance: 0.0012,
      liquidEdgeCompliance: 0.004, liquidBendCompliance: 0.025,
      restitution: 0.28, liquidRestitution: 0.055, maximumBounceHeightRatio: 0.55,
      minimumRadiusRatio: 0.76, liquidMinimumRadiusRatio: 0.34, impactRadiusAllowance: 0.24,
      floorImpactCompression: 0.52, liquidFloorImpactCompression: 0.82,
      packingRadiusRatio: 0.92, contactFriction: 0.10, minimumBoundaryAreaRatio: 0.8, restingDrag: 20, restingInternalDamping: 16,
      impactShapeRate: 4.0, impactThreshold: 80, impactCooldownSeconds: 0.1, impactDecay: 2.8,
      maximumSpeed: 2400,
    };
    for (var pk in parameters) {
      if (Object.prototype.hasOwnProperty.call(parameters, pk)) this.parameters[pk] = parameters[pk];
    }
    this.time = 0;
    this.impactEvents = [];
    this.impactTimes = new Map();
    this.bodies = [];
    this.obstacles = [];
    this.contacts = new Map();
    this.nextId = 1;
    this.accumulator = 0;
    this.lastLiquid = 0;
    this.lastTilt = 0;
    this.diagnostics = { sleepingBodies: 0, substeps: 0, membraneRepairs: 0, volumeRecoveries: 0 };
  }

  add(level, x, y, r, options = {}) {
    const initialRatio = clamp((options.growFrom != null ? options.growFrom : 1), 0.2, 1);
    const initialRadius = r * initialRatio;
    x = clamp(x, this.left + initialRadius + 1, this.right - initialRadius - 1);
    y = Math.min(y, this.floor - initialRadius - 1);
    const velocityX = (options.vx != null ? options.vx : 0);
    const velocityY = (options.vy != null ? options.vy : 0);
    var pc = choosePointCount(this.bodies.length);
    const points = [];
    for (var pti = 0; pti < pc; pti++) {
      var angle = pti * Math.PI * 2 / pc;
      points.push({ x: x + Math.cos(angle) * initialRadius, y: y + Math.sin(angle) * initialRadius, vx: velocityX, vy: velocityY, oldX: 0, oldY: 0 });
    }
    const body = {
      id: this.nextId++, level, r, x, y, stepStartX: x, stepStartY: y, vx: velocityX, vy: velocityY, age: 0, points,
      initialRatio, growthSeconds: initialRatio < 1 ? Math.max(options.growthSeconds != null ? options.growthSeconds : 0.35, 0.15) : 0,
      currentRadius: initialRadius, inverseMass: 900 / (r * r),
      edgeLambdas: new Float64Array(pc), bendLambdas: new Float64Array(pc),
      isSleeping: false, hasSupport: false, hasStableSupport: false, hasFloorSupport: false, stillSeconds: 0, repairRecoverySeconds: 0, area: 0, targetArea: 0,
      shapeImpulseA: 0, shapeImpulseB: 0, impactExcitation: 0, lastImpactSpeed: 0, floorBounceSpeed: 0, bounceX: 0, bounceY: 0,
    };
    this.updateRestShape(body);
    this.updateGeometry(body);
    this.bodies.push(body);
    return body;
  }

  remove(ids) {
    const removedIds = new Set(ids);
    this.bodies = this.bodies.filter(body => !removedIds.has(body.id));
    for (const [key, pair] of this.contacts) if (pair.some(body => removedIds.has(body.id))) this.contacts.delete(key);
    for (const body of this.bodies) this.wake(body);
  }

  clear() {
    this.bodies.length = 0;
    this.contacts.clear();
    this.accumulator = 0;
    this.time = 0;
    this.impactEvents.length = 0;
    this.impactTimes.clear();
  }

  getContacts() { return Array.from(this.contacts.values()); }

  takeImpactEvents() { return this.impactEvents.splice(0); }

  registerImpact(body, other, normalX, normalY, speed, x, y, contactKey) {
    if (speed < this.parameters.impactThreshold) return false;
    var _it = this.impactTimes.get(contactKey);
      var previousTime = _it != null ? _it : -Infinity;
    if (this.time - previousTime < this.parameters.impactCooldownSeconds) return false;
    this.impactTimes.set(contactKey, this.time);
    const excitation = clamp(speed / 800, 0, 1);
    body.impactExcitation = Math.max(body.impactExcitation, excitation);
    body.lastImpactSpeed = speed;
    this.wake(body);
    if (other) {
      other.impactExcitation = Math.max(other.impactExcitation, excitation);
      other.lastImpactSpeed = speed;
      this.wake(other);
    }
    // A trace-free strain impulse compresses along the contact normal and expands
    // across it. It changes real boundary velocities without translating the fruit.
    const strainRate = this.parameters.impactShapeRate * excitation * Math.pow((1 - this.lastLiquid), 2);
    const excite = (fruit, participation) => {
      participation *= Math.min(1, fruit.currentRadius / 48);
      fruit.shapeImpulseA += (1 - 2 * normalX * normalX) * strainRate * participation;
      fruit.shapeImpulseB += -2 * normalX * normalY * strainRate * participation;
    };
    excite(body, other ? Math.sqrt(other.r / (body.r + other.r)) : 1);
    if (other) excite(other, Math.sqrt(body.r / (body.r + other.r)));
    this.impactEvents.push({ id: body.id, otherId: (other ? other.id : null), x, y, normalX, normalY, speed });
    if (this.impactEvents.length > 64) this.impactEvents.shift();
    return true;
  }

  wake(body) { body.isSleeping = false; body.stillSeconds = 0; }

  updateRestShape(body) {
    const progress = body.growthSeconds ? clamp(body.age / body.growthSeconds, 0, 1) : 1;
    const easedProgress = progress * progress * (3 - 2 * progress);
    body.currentRadius = body.r * (body.initialRatio + (1 - body.initialRatio) * easedProgress);
    var n = body.points.length;
    body.edgeLength = 2 * body.currentRadius * Math.sin(Math.PI / n);
    body.bendLength = 2 * body.currentRadius * Math.sin(2 * Math.PI / n);
    body.targetArea = n * Math.pow(body.currentRadius, 2) * Math.sin(2 * Math.PI / n) / 2;
  }

  updateGeometry(body) {
    let centerX = 0, centerY = 0, area = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var n = body.points.length;
    for (let index = 0; index < n; index++) {
      const point = body.points[index];
      const next = body.points[(index + 1) % n];
      centerX += point.x; centerY += point.y;
      area += point.x * next.y - next.x * point.y;
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    Object.assign(body, { x: centerX / n, y: centerY / n, area: area * 0.5, minX, minY, maxX, maxY });
    body.bound = Math.hypot(maxX - minX, maxY - minY) * 0.5 + 2;
  }

  constrainDistance(first, second, restLength, alpha, inverseMass, lambdas, index, maximumStretch) {
    const dx = second.x - first.x, dy = second.y - first.y;
    const distance = Math.hypot(dx, dy) || 0.00001;
    const constraint = distance - restLength;
    const deltaLambda = (-constraint - alpha * lambdas[index]) / (2 * inverseMass + alpha);
    lambdas[index] += deltaLambda;
    let displacement = -inverseMass * deltaLambda;
    if (distance > restLength * maximumStretch) displacement = Math.max(displacement, (distance - restLength * maximumStretch) * 0.45);
    const scale = displacement / distance;
    first.x += dx * scale; first.y += dy * scale;
    second.x -= dx * scale; second.y -= dy * scale;
  }

  constrainArea(body) {
    let area = 0, gradientSquared = 0;
    const points = body.points;
    var n = points.length;
    for (let index = 0; index < n; index++) {
      const point = points[index], previous = points[(index + n - 1) % n], next = points[(index + 1) % n];
      area += point.x * next.y - next.x * point.y;
      point.areaX = (next.y - previous.y) * 0.5;
      point.areaY = (previous.x - next.x) * 0.5;
      gradientSquared += Math.pow(point.areaX, 2) + Math.pow(point.areaY, 2);
    }
    const pressure = clamp((body.targetArea - area * 0.5) / Math.max(gradientSquared, 1), -0.35, 0.35);
    for (const point of points) {
      point.x += point.areaX * pressure;
      point.y += point.areaY * pressure;
    }
  }

  repairFoldedMembrane(body) {
    const points = body.points;
    var n = points.length;
    let centerX = 0, centerY = 0;
    for (const point of points) { centerX += point.x; centerY += point.y; }
    centerX /= n; centerY /= n;
    let hasAngularFold = false;
    for (let index = 0; index < n; index++) {
      const first = points[index], second = points[(index + 1) % n];
      if ((first.x - centerX) * (second.y - centerY) - (first.y - centerY) * (second.x - centerX) < -0.0001) { hasAngularFold = true; break; }
    }
    if (!hasAngularFold) return;
    const side = (first, second, point) => (second.x - first.x) * (point.y - first.y) - (second.y - first.y) * (point.x - first.x);
    let hasCrossing = false;
    for (let firstIndex = 0; firstIndex < n && !hasCrossing; firstIndex++) {
      const first = points[firstIndex], second = points[(firstIndex + 1) % n];
      for (let secondIndex = firstIndex + 2; secondIndex < n; secondIndex++) {
        if (firstIndex === 0 && secondIndex === n - 1) continue;
        const third = points[secondIndex], fourth = points[(secondIndex + 1) % n];
        if (side(first, second, third) * side(first, second, fourth) < -0.000001 && side(third, fourth, first) * side(third, fourth, second) < -0.000001) { hasCrossing = true; break; }
      }
    }
    if (!hasCrossing) return;
    // Reconnect folded boundary samples without moving them or adding velocity.
    const textureAnchor = points[0];
    points.sort((first, second) => Math.atan2(first.y - centerY, first.x - centerX) - Math.atan2(second.y - centerY, second.x - centerX));
    const anchorIndex = points.indexOf(textureAnchor);
    if (anchorIndex) { var rotated = points.splice(0, anchorIndex); for (var ri = 0; ri < rotated.length; ri++) points.push(rotated[ri]); }
    body.edgeLambdas.fill(0); body.bendLambdas.fill(0);
    this.diagnostics.membraneRepairs++;
    return true;
  }

  constrainBody(body, liquid, solverPasses) {
    // Skip membrane repair on nearly-resting bodies (cheap path when crowded)
    if (!(body.stillSeconds > 0.15 && body.impactExcitation < 0.02)) {
      this.repairFoldedMembrane(body);
    }
    const points = body.points;
    var n = points.length;
    var passes = solverPasses != null ? solverPasses : SOLVER_PASSES;
    // Membrane compliance can change without making the enclosed volume compressible.
    const edgeAlpha = (this.parameters.edgeCompliance + Math.pow(liquid, 2) * (this.parameters.liquidEdgeCompliance - this.parameters.edgeCompliance)) * (1 + (body.inverseMass - 1) * (1 - liquid)) / (Math.pow(FIXED_STEP, 2));
    const bendAlpha = (this.parameters.bendCompliance + Math.pow(liquid, 2) * (this.parameters.liquidBendCompliance - this.parameters.bendCompliance)) * (1 + (body.inverseMass - 1) * (1 - liquid)) / (Math.pow(FIXED_STEP, 2));
    for (let index = 0; index < n; index++) {
      this.constrainDistance(points[index], points[(index + 1) % n], body.edgeLength, edgeAlpha, body.inverseMass, body.edgeLambdas, index, 1.3 + liquid * 0.94);
      this.constrainDistance(points[index], points[(index + 2) % n], body.bendLength, bendAlpha, body.inverseMass, body.bendLambdas, index, 1.35 + liquid * 1.2);
    }
    this.updateGeometry(body);
    const shapeFrequency = this.parameters.shapeFrequency + liquid * (this.parameters.liquidShapeFrequency - this.parameters.shapeFrequency);
    const returnStrength = Math.pow((2 * Math.PI * shapeFrequency * FIXED_STEP), 2) / passes;
    for (const point of points) {
      const dx = point.x - body.x, dy = point.y - body.y;
      const distance = Math.hypot(dx, dy) || 1;
      const limitedRadius = clamp(distance, body.currentRadius * (this.parameters.minimumRadiusRatio + liquid * (this.parameters.liquidMinimumRadiusRatio - this.parameters.minimumRadiusRatio) - body.impactExcitation * this.parameters.impactRadiusAllowance * (1 - liquid)), body.currentRadius * 1.85);
      const scale = ((limitedRadius - distance) + (body.currentRadius - distance) * returnStrength) / distance;
      point.x += dx * scale; point.y += dy * scale;
    }
    this.constrainArea(body);
    this.updateGeometry(body);
  }

  constrainBoundaries(body, liquid) {
    const points = body.points;
    let minimumX = Infinity, maximumX = -Infinity, maximumY = -Infinity;
    for (const point of points) {
      minimumX = Math.min(minimumX, point.x); maximumX = Math.max(maximumX, point.x); maximumY = Math.max(maximumY, point.y);
    }
    if (maximumY >= this.floor - 1.05) { body.hasSupport = true; body.hasStableSupport = true; body.hasFloorSupport = true; }
    if (maximumY > this.floor - 1 && body.frameVelocityY > 0) {
      const contactPoint = points.reduce((lowest, point) => point.y > lowest.y ? point : lowest, points[0]);
      if (this.registerImpact(body, null, 0, -1, body.frameVelocityY, contactPoint.x, this.floor - 1, body.id + ':floor')) {
        body.floorBounceSpeed = Math.min(body.frameVelocityY * (this.parameters.restitution + liquid * (this.parameters.liquidRestitution - this.parameters.restitution)), Math.sqrt(2 * this.parameters.gravity * body.currentRadius * this.parameters.maximumBounceHeightRatio));
      }
    }
    if (minimumX < this.left + 1 && body.frameVelocityX < 0) this.registerImpact(body, null, 1, 0, -body.frameVelocityX, this.left + 1, body.y, body.id + ':left');
    if (maximumX > this.right - 1 && body.frameVelocityX > 0) this.registerImpact(body, null, -1, 0, body.frameVelocityX, this.right - 1, body.y, body.id + ':right');
    // Impact temporarily redirects motion into the membrane; settled contacts remain firm.
    let bulkResponse = (0.68 + liquid * 0.30) - (this.parameters.floorImpactCompression * Math.min(1, body.currentRadius / 28) + liquid * (this.parameters.liquidFloorImpactCompression - this.parameters.floorImpactCompression)) * body.impactExcitation;
    const boundaryShiftX = Math.max(this.left + 1 - minimumX, 0) - Math.max(maximumX - this.right + 1, 0);
    const boundaryShiftY = -Math.max(maximumY - this.floor + 1, 0);
    if (boundaryShiftX || boundaryShiftY) {
      const projectedArea = response => {
        let area = 0;
        var pn = points.length;
        for (let index = 0; index < pn; index++) {
          const first = points[index], second = points[(index + 1) % pn];
          const firstX = clamp(first.x + boundaryShiftX * response, this.left + 1, this.right - 1);
          const firstY = Math.min(first.y + boundaryShiftY * response, this.floor - 1);
          const secondX = clamp(second.x + boundaryShiftX * response, this.left + 1, this.right - 1);
          const secondY = Math.min(second.y + boundaryShiftY * response, this.floor - 1);
          area += firstX * secondY - secondX * firstY;
        }
        return area * 0.5;
      };
      const minimumArea = body.targetArea * this.parameters.minimumBoundaryAreaRatio;
      if (projectedArea(bulkResponse) < minimumArea) {
        // A corner must move an overloaded fruit inward instead of clipping it flat.
        let lowerResponse = bulkResponse, upperResponse = 1;
        for (let iteration = 0; iteration < 6; iteration++) {
          const middleResponse = (lowerResponse + upperResponse) * 0.5;
          if (projectedArea(middleResponse) < minimumArea) lowerResponse = middleResponse;
          else upperResponse = middleResponse;
        }
        bulkResponse = upperResponse;
      }
    }
    const bulkX = boundaryShiftX * bulkResponse;
    const bulkY = boundaryShiftY * bulkResponse;
    for (const point of points) {
      point.x += bulkX; point.y += bulkY;
      point.x = clamp(point.x, this.left + 1, this.right - 1);
      point.y = Math.min(point.y, this.floor - 1);
    }
    if (this.repairFoldedMembrane(body)) {
      // Reconnecting crossed samples can change area. Restore it before returning
      // from the final boundary pass, then move the whole fruit inside the walls.
      this.updateGeometry(body);
      const areaScale = Math.max(1, body.targetArea * 0.96 / Math.max(body.area, 1));
      const horizontalScale = Math.min(Math.sqrt(areaScale), (this.right - this.left - 2) / Math.max(body.maxX - body.minX, 1));
      const verticalScale = areaScale / horizontalScale;
      for (const point of points) {
        point.x = body.x + (point.x - body.x) * horizontalScale;
        point.y = body.y + (point.y - body.y) * verticalScale;
      }
      this.updateGeometry(body);
      const repairShiftX = Math.max(this.left + 1 - body.minX, 0) - Math.max(body.maxX - this.right + 1, 0);
      const repairShiftY = -Math.max(body.maxY - this.floor + 1, 0);
      for (const point of points) {
        point.x = clamp(point.x + repairShiftX, this.left + 1, this.right - 1);
        point.y = Math.min(point.y + repairShiftY, this.floor - 1);
      }
    }
    for (const obstacle of this.obstacles) {
      if (body.maxX < obstacle.x - obstacle.r - 2 || body.minX > obstacle.x + obstacle.r + 2 || body.maxY < obstacle.y - obstacle.r - 2 || body.minY > obstacle.y + obstacle.r + 2) continue;
      // Resolve the complete edge, since clear vertices can still leave a chord inside a circle.
      var on = points.length;
      for (let index = 0; index < on; index++) {
        const first = points[index], second = points[(index + 1) % on];
        const edgeX = second.x - first.x, edgeY = second.y - first.y;
        const fraction = clamp(((obstacle.x - first.x) * edgeX + (obstacle.y - first.y) * edgeY) / (Math.pow(edgeX, 2) + Math.pow(edgeY, 2) || 1), 0, 1);
        const dx = first.x + fraction * edgeX - obstacle.x;
        const dy = first.y + fraction * edgeY - obstacle.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= obstacle.r + 0.08) continue;
        const firstWeight = 1 - fraction, secondWeight = fraction;
        const normalX = distance > 0.00001 ? dx / distance : (body.x > obstacle.x ? 1 : -1);
        const normalY = distance > 0.00001 ? dy / distance : 0;
        this.registerImpact(body, null, normalX, normalY, -body.frameVelocityX * normalX - body.frameVelocityY * normalY, obstacle.x + normalX * obstacle.r, obstacle.y + normalY * obstacle.r, body.id + ':circle:' + obstacle.x + ',' + obstacle.y);
        const push = Math.min(obstacle.r + 0.08 - distance, 12) / (Math.pow(firstWeight, 2) + Math.pow(secondWeight, 2));
        first.x += normalX * push * firstWeight; first.y += normalY * push * firstWeight;
        second.x += normalX * push * secondWeight; second.y += normalY * push * secondWeight;
      }
    }
  }

  restoreMinimumArea(body) {
    // A rare last-pass corner squeeze must not erase a small fruit's volume.
    // Affine expansion preserves vertex order; translate the whole shape inside.
    const areaScale = body.targetArea * .8 / Math.max(body.area, 1);
    const scaleX = Math.min(Math.sqrt(areaScale), (this.right - this.left - 2) / Math.max(body.maxX - body.minX, 1));
    const scaleY = areaScale / scaleX;
    for (const point of body.points) {
      point.x = body.x + (point.x - body.x) * scaleX;
      point.y = body.y + (point.y - body.y) * scaleY;
    }
    this.updateGeometry(body);
    const shiftX = Math.max(this.left + 1 - body.minX, 0) - Math.max(body.maxX - this.right + 1, 0);
    const shiftY = -Math.max(body.maxY - this.floor + 1, 0);
    for (const point of body.points) { point.x += shiftX; point.y += shiftY; }
    this.updateGeometry(body);
    this.wake(body);
    this.diagnostics.volumeRecoveries++;
  }

  constrainPackingDistance(first, second) {
    // A firm interior keeps small fruit wedged between larger neighbours.
    // The membrane can still oscillate; softening releases this constraint.
    const dx = second.x - first.x, dy = second.y - first.y;
    const distance = Math.hypot(dx, dy);
    const minimum = (first.currentRadius + second.currentRadius) * this.parameters.packingRadiusRatio * (1 - this.lastLiquid);
    if (distance >= minimum || distance < 0.00001) return;
    const overlap = Math.min(minimum - distance, 12);
    if (overlap > .55) { this.wake(first); this.wake(second); }
    const firstMass = first.isSleeping ? 0 : first.inverseMass;
    const secondMass = second.isSleeping ? 0 : second.inverseMass;
    if (!firstMass && !secondMass) return;
    const nx = dx / distance, ny = dy / distance;
    if (ny > .3) first.hasSupport = true;
    if (ny < -.3) second.hasSupport = true;
    if (ny > .55) first.hasStableSupport = true;
    if (ny < -.55) second.hasStableSupport = true;
    var firstAmount = -overlap * firstMass / (firstMass + secondMass);
    var secondAmount = overlap * secondMass / (firstMass + secondMass);
    if (firstAmount) {
      for (var pi = 0; pi < first.points.length; pi++) {
        var point = first.points[pi];
        point.x += nx * firstAmount; point.y += ny * firstAmount;
        if (first.isPlacementRepair) { point.repairX += nx * firstAmount; point.repairY += ny * firstAmount; }
      }
      this.updateGeometry(first);
    }
    if (secondAmount) {
      for (var qi = 0; qi < second.points.length; qi++) {
        var qpoint = second.points[qi];
        qpoint.x += nx * secondAmount; qpoint.y += ny * secondAmount;
        if (second.isPlacementRepair) { qpoint.repairX += nx * secondAmount; qpoint.repairY += ny * secondAmount; }
      }
      this.updateGeometry(second);
    }
  }

  collideVertices(source, target) {
    let minimumOverlap = Infinity, normalX = 0, normalY = 0;
    for (const polygon of [source, target]) {
      var pn = polygon.points.length;
      for (let index = 0; index < pn; index++) {
        const first = polygon.points[index], second = polygon.points[(index + 1) % pn];
        const edgeX = second.x - first.x, edgeY = second.y - first.y;
        const length = Math.hypot(edgeX, edgeY);
        if (length < 0.00001) continue;
        const axisX = edgeY / length, axisY = -edgeX / length;
        let sourceMin = Infinity, sourceMax = -Infinity, targetMin = Infinity, targetMax = -Infinity;
        for (const point of source.points) {
          const projection = point.x * axisX + point.y * axisY;
          sourceMin = Math.min(sourceMin, projection); sourceMax = Math.max(sourceMax, projection);
        }
        for (const point of target.points) {
          const projection = point.x * axisX + point.y * axisY;
          targetMin = Math.min(targetMin, projection); targetMax = Math.max(targetMax, projection);
        }
        const forwardOverlap = sourceMax - targetMin, backwardOverlap = targetMax - sourceMin;
        if (forwardOverlap < -1.2 || backwardOverlap < -1.2) return false;
        const overlap = Math.min(forwardOverlap, backwardOverlap);
        if (overlap < minimumOverlap) {
          minimumOverlap = overlap;
          const direction = forwardOverlap <= backwardOverlap ? 1 : -1;
          normalX = axisX * direction; normalY = axisY * direction;
        }
      }
    }
    if (normalY > 0.3) source.hasSupport = true;
    if (normalY < -0.3) target.hasSupport = true;
    if (normalY > 0.55) source.hasStableSupport = true;
    if (normalY < -0.55) target.hasStableSupport = true;
    if (minimumOverlap <= 0) return true;
    // Wake side contacts, perched stacks, and any sleeping body touching a moving one.
    // Never freeze a fruit that is sitting on another fruit.
    var relSpeed = Math.hypot(source.vx - target.vx, source.vy - target.vy);
    var shallowSupport = Math.abs(normalY) < 0.72;
    var perched = Math.abs(source.y - target.y) > Math.min(source.currentRadius, target.currentRadius) * 0.35;
    if (
      minimumOverlap > 0.25 ||
      relSpeed > 6 ||
      shallowSupport ||
      perched ||
      (source.isSleeping && !target.isSleeping) ||
      (target.isSleeping && !source.isSleeping)
    ) {
      if (source.isSleeping) this.wake(source);
      if (target.isSleeping) this.wake(target);
    }
    const sourceMass = source.isSleeping ? 0 : source.inverseMass;
    const targetMass = target.isSleeping ? 0 : target.inverseMass;
    if (sourceMass + targetMass === 0) return true;
    const sourceIsGrowing = source.growthSeconds > 0 && source.age < source.growthSeconds + 0.12;
    const targetIsGrowing = target.growthSeconds > 0 && target.age < target.growthSeconds + 0.12;
    const isBirthRepair = source.isPlacementRepair || target.isPlacementRepair || sourceIsGrowing || targetIsGrowing || (minimumOverlap > 3 && (source.age < 0.15 || target.age < 0.15));
    if (isBirthRepair) {
      source.isPlacementRepair = true; target.isPlacementRepair = true;
      source.repairRecoverySeconds = 0.3; target.repairRecoverySeconds = 0.3;
      const closingSpeed = (target.frameVelocityX - source.frameVelocityX) * normalX + (target.frameVelocityY - source.frameVelocityY) * normalY;
      if (closingSpeed < 0) {
        const impulse = -closingSpeed / (sourceMass + targetMass);
        source.frameVelocityX -= normalX * impulse * sourceMass; source.frameVelocityY -= normalY * impulse * sourceMass;
        target.frameVelocityX += normalX * impulse * targetMass; target.frameVelocityY += normalY * impulse * targetMass;
      }
    }
    // Large overlaps need placement correction, not a large loss of enclosed area.
    if (!isBirthRepair) {
      const impactSpeed = (source.frameVelocityX - target.frameVelocityX) * normalX + (source.frameVelocityY - target.frameVelocityY) * normalY;
      let sourcePoint = source.points[0], targetPoint = target.points[0];
      for (const point of source.points) if (point.x * normalX + point.y * normalY > sourcePoint.x * normalX + sourcePoint.y * normalY) sourcePoint = point;
      for (const point of target.points) if (point.x * normalX + point.y * normalY < targetPoint.x * normalX + targetPoint.y * normalY) targetPoint = point;
      if (this.registerImpact(source, target, -normalX, -normalY, impactSpeed, (sourcePoint.x + targetPoint.x) / 2, (sourcePoint.y + targetPoint.y) / 2, Math.min(source.id, target.id) + ':' + Math.max(source.id, target.id))) {
        const restitution = this.parameters.restitution + this.lastLiquid * (this.parameters.liquidRestitution - this.parameters.restitution);
        const rebound = impactSpeed * restitution * 0.5 / (sourceMass + targetMass);
        source.bounceX -= normalX * rebound * sourceMass; source.bounceY -= normalY * rebound * sourceMass;
        target.bounceX += normalX * rebound * targetMass; target.bounceY += normalY * rebound * targetMass;
      }
    }
    const excitation = isBirthRepair ? 0 : Math.max(source.impactExcitation, target.impactExcitation);
    const elasticShare = 1 - this.lastLiquid;
    const areaAllowance = clamp((Math.min(source.area / source.targetArea, target.area / target.targetArea) - 0.82) / 0.18, 0, 1);
    const maximumLocalDeflection = Math.min(source.currentRadius, target.currentRadius) * (0.02 + excitation * 0.2 + elasticShare * (0.06 + excitation * 0.14)) * areaAllowance;
    const localFraction = 0.12 + excitation * 0.62 + elasticShare * (0.26 - excitation * 0.12);
    const bulkSeparation = isBirthRepair ? minimumOverlap : minimumOverlap - Math.min(minimumOverlap * localFraction, maximumLocalDeflection);
    const sourceShift = bulkSeparation * sourceMass / (sourceMass + targetMass);
    const targetShift = bulkSeparation * targetMass / (sourceMass + targetMass);
    const tangentX = -normalY, tangentY = normalX;
    let frictionDisplacement = 0;
    // Tangential stickiness scales with support-like contacts (|nY| high). Side/slope
    // contacts keep low friction so small fruits slide off large curves.
    if (!isBirthRepair && this.parameters.contactFriction > 0) {
      const relativeX = target.x - target.stepStartX - source.x + source.stepStartX;
      const relativeY = target.y - target.stepStartY - source.y + source.stepStartY;
      const supportDisplacement = this.parameters.gravity * Math.pow(FIXED_STEP, 2) * Math.abs(normalY);
      const slopeFactor = Math.pow(Math.abs(normalY), 1.35);
      const frictionLimit = this.parameters.contactFriction * slopeFactor * (1 - this.lastLiquid) * (minimumOverlap * 0.65 + supportDisplacement);
      frictionDisplacement = clamp(relativeX * tangentX + relativeY * tangentY, -frictionLimit, frictionLimit);
    }
    const sourceFriction = frictionDisplacement * sourceMass / (sourceMass + targetMass);
    const targetFriction = frictionDisplacement * targetMass / (sourceMass + targetMass);
    if (sourceMass) for (const point of source.points) {
      point.x += -normalX * sourceShift + tangentX * sourceFriction; point.y += -normalY * sourceShift + tangentY * sourceFriction;
      if (isBirthRepair) { point.repairX -= normalX * sourceShift; point.repairY -= normalY * sourceShift; }
    }
    if (targetMass) for (const point of target.points) {
      point.x += normalX * targetShift - tangentX * targetFriction; point.y += normalY * targetShift - tangentY * targetFriction;
      if (isBirthRepair) { point.repairX += normalX * targetShift; point.repairY += normalY * targetShift; }
    }
    let sourceSupport = -Infinity, targetSupport = Infinity;
    for (const point of source.points) sourceSupport = Math.max(sourceSupport, point.x * normalX + point.y * normalY);
    for (const point of target.points) targetSupport = Math.min(targetSupport, point.x * normalX + point.y * normalY);
    const contactPlane = sourceSupport - (sourceSupport - targetSupport) * sourceMass / (sourceMass + targetMass);
    // Clip both contact faces to the same plane; crossing edges cannot escape vertex tests.
    if (sourceMass) for (const point of source.points) {
      const penetration = Math.min(Math.max(point.x * normalX + point.y * normalY - contactPlane, 0), 12);
      point.x -= normalX * penetration; point.y -= normalY * penetration;
      if (isBirthRepair) { point.repairX -= normalX * penetration; point.repairY -= normalY * penetration; }
    }
    if (targetMass) for (const point of target.points) {
      const penetration = Math.min(Math.max(contactPlane - point.x * normalX - point.y * normalY, 0), 12);
      point.x += normalX * penetration; point.y += normalY * penetration;
      if (isBirthRepair) { point.repairX += normalX * penetration; point.repairY += normalY * penetration; }
    }
    this.updateGeometry(source); this.updateGeometry(target);
    return true;
  }

  step(dt, opts) {
    opts = opts || {};
    var liquid = opts.liquid != null ? opts.liquid : 0;
    var tilt = opts.tilt != null ? opts.tilt : 0;
    if (!Number.isFinite(dt) || dt <= 0) return;
    liquid = clamp(liquid, 0, 1); tilt = clamp(tilt, -1, 1);
    if (Math.abs(liquid - this.lastLiquid) > 0.0001 || Math.abs(tilt - this.lastTilt) > 0.0001) for (const body of this.bodies) this.wake(body);
    this.lastLiquid = liquid; this.lastTilt = tilt;
    this.accumulator += Math.min(dt, 0.05);
      var bodyCount = this.bodies.length;
      var maxSub = MAX_SUBSTEPS;
      var solverPasses = SOLVER_PASSES;
      var restingDragMul = 1;
      var sleepStillNeed = 0.65;
      // Adaptive quality: keep full jelly feel for few fruits; throttle when crowded
      if (bodyCount >= 18) {
        maxSub = 1;
        solverPasses = 1;
        restingDragMul = 1.35;
        sleepStillNeed = 0.55;
      } else if (bodyCount >= 12) {
        maxSub = 1;
        solverPasses = 2;
        restingDragMul = 1.15;
        sleepStillNeed = 0.6;
      }
      this._solverPasses = solverPasses;
      var substeps = 0;
      while (this.accumulator + 1e-12 >= FIXED_STEP && substeps < maxSub) {
        substeps++;
      this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
      const previousContacts = this.contacts;
      var nextContacts = this._contactsAlt;
      if (!nextContacts) { nextContacts = new Map(); this._contactsAlt = nextContacts; }
      nextContacts.clear();
      this.contacts = nextContacts;
      this._contactsAlt = previousContacts;
      this.diagnostics.substeps++;
      this.time += FIXED_STEP;
      const airRetention = Math.exp(-this.parameters.airDrag * FIXED_STEP);
      for (const body of this.bodies) {
        body.stepStartX = body.x; body.stepStartY = body.y;
        body.age += FIXED_STEP;
        body.hasSupport = false;
        body.hasStableSupport = false;
        body.hasFloorSupport = false;
        body.impactExcitation *= Math.exp(-(this.parameters.impactDecay + liquid * (5.5 - this.parameters.impactDecay)) * FIXED_STEP);
        body.floorBounceSpeed = 0; body.bounceX = 0; body.bounceY = 0;
        body.isPlacementRepair = false;
        body.repairRecoverySeconds = Math.max(0, body.repairRecoverySeconds - FIXED_STEP);
        body.frameVelocityX = body.vx * airRetention + tilt * 560 * FIXED_STEP;
        body.frameVelocityY = body.vy * airRetention + this.parameters.gravity * FIXED_STEP;
        for (const point of body.points) { point.repairX = 0; point.repairY = 0; }
        if (body.isSleeping) continue;
        this.updateRestShape(body);
        body.edgeLambdas.fill(0); body.bendLambdas.fill(0);
        for (const point of body.points) {
          point.oldX = point.x; point.oldY = point.y;
          point.vx = clamp(body.frameVelocityX + point.vx - body.vx, -this.parameters.maximumSpeed, this.parameters.maximumSpeed);
          point.vy = clamp(body.frameVelocityY + point.vy - body.vy, -this.parameters.maximumSpeed, this.parameters.maximumSpeed);
          point.x += point.vx * FIXED_STEP; point.y += point.vy * FIXED_STEP;
        }
        this.updateGeometry(body);
      }
      for (let pass = 0; pass < solverPasses; pass++) {
        for (const body of this.bodies) if (!body.isSleeping) this.constrainBody(body, liquid, solverPasses);
        for (let firstIndex = 0; firstIndex < this.bodies.length; firstIndex++) {
          const first = this.bodies[firstIndex];
          for (let secondIndex = firstIndex + 1; secondIndex < this.bodies.length; secondIndex++) {
            const second = this.bodies[secondIndex];
            // Broadphase: skip far AABB pairs (use bound radii when available)
            var pad = 1.2;
            if (first.maxX + pad < second.minX || second.maxX + pad < first.minX || first.maxY + pad < second.minY || second.maxY + pad < first.minY) continue;
            if (first.bound && second.bound) {
              var dxc = first.x - second.x, dyc = first.y - second.y;
              var far = first.bound + second.bound + pad;
              if (dxc * dxc + dyc * dyc > far * far) continue;
            }
            const key = first.id + ':' + second.id;
            // Early-out: both sleeping on floor pile — keep prior contact.
            // If clearly stacked (one above the other), still collide/wake.
            if (first.isSleeping && second.isSleeping) {
              var stackDy = Math.abs(first.y - second.y);
              var stackThresh = Math.min(first.currentRadius || first.r || 20, second.currentRadius || second.r || 20) * 0.4;
              if (stackDy <= stackThresh) {
                if (previousContacts.has(key)) this.contacts.set(key, [first, second]);
                continue;
              }
              this.wake(first);
              this.wake(second);
            }
            // One sleeping + far centers: skip (AABB already passed but center far)
            if ((first.isSleeping || second.isSleeping) && first.bound && second.bound) {
              var dxs = first.x - second.x, dys = first.y - second.y;
              var near = (first.bound + second.bound) * 0.85;
              if (dxs * dxs + dys * dys > near * near) continue;
            }
            const firstContact = this.collideVertices(first, second);
            if (firstContact) { this.contacts.set(key, [first, second]); this.constrainPackingDistance(first, second); }
          }
        }
        for (const body of this.bodies) if (!body.isSleeping) this.constrainBoundaries(body, liquid);
      }
      for (const body of this.bodies) {
        if (body.isSleeping) continue;
        let velocityX = 0, velocityY = 0;
        if (body.isPlacementRepair && body.points.some(point => point.y >= this.floor - 1.001)) body.frameVelocityY = Math.min(body.frameVelocityY, 0);
        for (const point of body.points) {
          // Placement repairs remove overlap; they must not become a launch impulse.
          point.vx = clamp((point.x - point.oldX - point.repairX) / FIXED_STEP, -this.parameters.maximumSpeed, this.parameters.maximumSpeed);
          point.vy = clamp((point.y - point.oldY - point.repairY) / FIXED_STEP, -this.parameters.maximumSpeed, this.parameters.maximumSpeed);
          if (body.isPlacementRepair) {
            point.vx = body.frameVelocityX;
            point.vy = body.frameVelocityY;
          } else if (body.repairRecoverySeconds > 0) {
            const velocityBlend = 1 - body.repairRecoverySeconds / 0.3;
            point.vx = body.frameVelocityX + (point.vx - body.frameVelocityX) * velocityBlend;
            point.vy = body.frameVelocityY + (point.vy - body.frameVelocityY) * velocityBlend;
          }
          if (point.y >= this.floor - 1.001) { point.vx *= 0.8 + liquid * 0.14; point.vy = Math.min(point.vy, 0); }
          velocityX += point.vx; velocityY += point.vy;
        }
        body.vx = velocityX / body.points.length; body.vy = velocityY / body.points.length;
        const reboundY = body.floorBounceSpeed > 0 ? Math.min(0, -body.floorBounceSpeed - body.vy) : 0;
        if (reboundY || body.bounceX || body.bounceY) {
          for (const point of body.points) { point.vx += body.bounceX; point.vy += body.bounceY + reboundY; }
          body.vx += body.bounceX; body.vy += body.bounceY + reboundY;
        }
        if (body.shapeImpulseA || body.shapeImpulseB) {
          this.updateGeometry(body);
          const strainMagnitude = Math.hypot(body.shapeImpulseA, body.shapeImpulseB);
          const strainLimit = Math.min(1, this.parameters.impactShapeRate / strainMagnitude);
          const strainA = body.shapeImpulseA * strainLimit, strainB = body.shapeImpulseB * strainLimit;
          for (const point of body.points) {
            const dx = point.x - body.x, dy = point.y - body.y;
            point.vx += strainA * dx + strainB * dy;
            point.vy += strainB * dx - strainA * dy;
          }
          body.shapeImpulseA = 0; body.shapeImpulseB = 0;
        }
        // Let visible impact oscillations finish, then damp tiny supported motion.
        const isSettling = body.hasFloorSupport && liquid < 0.01 && Math.abs(tilt) < 0.01 && body.impactExcitation < 0.012 && Math.hypot(body.vx, body.vy) < 40;
        if (isSettling) {
          const retention = Math.exp(-this.parameters.restingDrag * restingDragMul * FIXED_STEP);
          const shiftX = body.vx * (retention - 1), shiftY = body.vy * (retention - 1);
          body.vx += shiftX; body.vy += shiftY;
          for (const point of body.points) { point.vx += shiftX; point.vy += shiftY; }
        }
        let internalSpeedSquared = 0;
        const dampingRate = isSettling ? this.parameters.restingInternalDamping : this.parameters.internalDamping + liquid * (this.parameters.liquidInternalDamping - this.parameters.internalDamping);
        const damping = Math.exp(-dampingRate * FIXED_STEP);
        for (const point of body.points) {
          point.vx = body.vx + (point.vx - body.vx) * damping;
          point.vy = body.vy + (point.vy - body.vy) * damping;
          internalSpeedSquared += Math.pow((point.vx - body.vx), 2) + Math.pow((point.vy - body.vy), 2);
        }
        this.updateGeometry(body);
        if (body.area < body.targetArea * .75) this.restoreMinimumArea(body);
        if (body.age > body.growthSeconds + 0.5 && body.hasFloorSupport && body.hasStableSupport && liquid < 0.01 && Math.abs(tilt) < 0.01 && body.impactExcitation < 0.012 && Math.hypot(body.vx, body.vy) < 5 && internalSpeedSquared / body.points.length < 36 && Math.abs(body.area / body.targetArea - 1) < 0.035) body.stillSeconds += FIXED_STEP;
        else body.stillSeconds = 0;
        if (body.stillSeconds > sleepStillNeed) {
          body.isSleeping = true; body.vx = 0; body.vy = 0;
          for (const point of body.points) { point.vx = 0; point.vy = 0; }
        }
      }
      var sleepingCount = 0;
      for (var si = 0; si < this.bodies.length; si++) if (this.bodies[si].isSleeping) sleepingCount++;
      this.diagnostics.sleepingBodies = sleepingCount;
      }
      if (this.accumulator > FIXED_STEP * 2) this.accumulator = 0;
    }
}

module.exports = {
  SoftWorld: SoftWorld,
  POINT_COUNT: POINT_COUNT,
  FIXED_STEP: FIXED_STEP,
  SOLVER_PASSES: SOLVER_PASSES,
  MAX_SUBSTEPS: MAX_SUBSTEPS,
  clamp: clamp,
};
