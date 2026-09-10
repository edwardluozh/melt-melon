import Matter from 'matter-js';
import { getFruit, type FruitDef } from './fruits';

export const LOGICAL_W = 375;
export const LOGICAL_H = 667;
export const WALL_THICKNESS = 40;
export const FAIL_LINE_Y = 90;
export const DROP_Y = 52;

export interface FruitBodyData {
  kind: 'fruit';
  level: number;
  settledAtAbove?: number | null;
}

export function createEngine(): Matter.Engine {
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: 1.05, scale: 0.001 },
  });
  engine.enableSleeping = true;
  return engine;
}

export function createWalls(world: Matter.World): Matter.Body[] {
  const t = WALL_THICKNESS;
  const w = LOGICAL_W;
  const h = LOGICAL_H;
  const opts: Matter.IChamferableBodyDefinition = {
    isStatic: true,
    friction: 0.8,
    restitution: 0.05,
    label: 'wall',
  };
  const left = Matter.Bodies.rectangle(-t / 2, h / 2, t, h + t * 2, opts);
  const right = Matter.Bodies.rectangle(w + t / 2, h / 2, t, h + t * 2, opts);
  const bottom = Matter.Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, opts);
  Matter.World.add(world, [left, right, bottom]);
  return [left, right, bottom];
}

export function createFruitBody(x: number, y: number, level: number, options?: {
  isStatic?: boolean;
}): Matter.Body {
  const def = getFruit(level);
  const body = Matter.Bodies.circle(x, y, def.radius, {
    isStatic: options?.isStatic ?? false,
    restitution: 0.12,
    friction: 0.35,
    frictionAir: 0.01,
    density: 0.002 + level * 0.00015,
    sleepThreshold: 30,
    label: `fruit-${level}`,
  });
  (body as Matter.Body & { plugin: FruitBodyData }).plugin = {
    kind: 'fruit',
    level,
    settledAtAbove: null,
  };
  return body;
}

export function getFruitData(body: Matter.Body): FruitBodyData | null {
  const data = (body as Matter.Body & { plugin?: FruitBodyData }).plugin;
  if (data && data.kind === 'fruit') return data;
  return null;
}

export function isFruitBody(body: Matter.Body): boolean {
  return getFruitData(body) !== null;
}

export function fruitDefOf(body: Matter.Body): FruitDef | null {
  const data = getFruitData(body);
  return data ? getFruit(data.level) : null;
}
