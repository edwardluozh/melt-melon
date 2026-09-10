import Matter from 'matter-js';
import { getFruit, nextLevel } from './fruits';
import { createFruitBody, getFruitData, isFruitBody } from './physics';

export type MergeCallback = (gained: number, level: number, x: number, y: number) => void;

/**
 * 监听碰撞：同级水果合成下一级。
 * 用 Set 防止同一 body 被双重合成。
 */
export function attachMergeHandler(
  engine: Matter.Engine,
  onMerge: MergeCallback,
  isActive: () => boolean,
): { processing: Set<number>; detach: () => void } {
  const processing = new Set<number>();

  const onCollision = (event: Matter.IEventCollision<Matter.Engine>) => {
    if (!isActive()) return;

    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (!isFruitBody(a) || !isFruitBody(b)) continue;
      if (processing.has(a.id) || processing.has(b.id)) continue;

      const da = getFruitData(a)!;
      const db = getFruitData(b)!;
      if (da.level !== db.level) continue;

      const next = nextLevel(da.level);
      if (next === null) continue;

      processing.add(a.id);
      processing.add(b.id);

      const midX = (a.position.x + b.position.x) / 2;
      const midY = (a.position.y + b.position.y) / 2;
      const fromLevel = da.level;
      const baseScore = getFruit(next).score;

      Matter.World.remove(engine.world, a);
      Matter.World.remove(engine.world, b);

      const spawned = createFruitBody(midX, midY, next);
      Matter.Body.setVelocity(spawned, {
        x: (a.velocity.x + b.velocity.x) * 0.25,
        y: Math.min(0, (a.velocity.y + b.velocity.y) * 0.25) - 1.5,
      });
      Matter.World.add(engine.world, spawned);

      onMerge(baseScore, fromLevel, midX, midY);

      // 短暂锁定，避免瞬间连锁把同一对重复处理；新 body 可继续合成
      window.setTimeout(() => {
        processing.delete(a.id);
        processing.delete(b.id);
      }, 80);
    }
  };

  Matter.Events.on(engine, 'collisionStart', onCollision);

  return {
    processing,
    detach: () => {
      Matter.Events.off(engine, 'collisionStart', onCollision);
      processing.clear();
    },
  };
}
