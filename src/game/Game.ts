import Matter from 'matter-js';
import { drawFruit, getFruit, randomDropLevel } from './fruits';
import { attachMergeHandler } from './merge';
import {
  LOGICAL_W,
  LOGICAL_H,
  FAIL_LINE_Y,
  DROP_Y,
  createEngine,
  createWalls,
  createFruitBody,
  getFruitData,
  isFruitBody,
} from './physics';
import { ScoreManager } from './score';
import {
  bindUI,
  updateScoreHUD,
  showGameOver,
  hideGameOver,
  drawNextPreview,
  type UIElements,
} from './ui';

const DROP_COOLDOWN_MS = 450;
const FAIL_HOLD_MS = 3000;

type PointerMode = 'idle' | 'aiming' | 'cancelled';

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ui: UIElements;
  private engine: Matter.Engine;
  private scoreMgr = new ScoreManager();

  private pendingLevel = 0;
  private nextLevel = 0;
  private aiming = false;
  private aimX = LOGICAL_W / 2;
  private pointerMode: PointerMode = 'idle';
  private canDrop = true;
  private gameOver = false;
  private running = false;
  private lastTs = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private displayW = LOGICAL_W;
  private displayH = LOGICAL_H;
  private floatTexts: { x: number; y: number; text: string; life: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.ui = bindUI();
    this.engine = createEngine();
    createWalls(this.engine.world);

    this.pendingLevel = randomDropLevel();
    this.nextLevel = randomDropLevel();
    this.bindMerge();
    this.bindInput();
    this.bindButtons();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    updateScoreHUD(this.ui, 0, this.scoreMgr.highScore);
    drawNextPreview(this.ui.nextCanvas, this.nextLevel);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      if (!this.running) return;
      const dt = Math.min(32, ts - this.lastTs);
      this.lastTs = ts;
      this.update(dt);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private bindMerge(): void {
    const handler = attachMergeHandler(
      this.engine,
      (baseScore, _level, x, y) => {
        const gained = this.scoreMgr.addMerge(baseScore);
        updateScoreHUD(this.ui, this.scoreMgr.score, this.scoreMgr.highScore);
        this.floatTexts.push({
          x,
          y,
          text: `+${gained}`,
          life: 700,
        });
      },
      () => !this.gameOver,
    );
    void handler.detach;
  }

  private bindButtons(): void {
    const restart = () => this.restart();
    this.ui.btnRestart.addEventListener('click', restart);
    this.ui.btnOverlayRestart.addEventListener('click', restart);
  }

  private bindInput(): void {
    const el = this.canvas;

    const onDown = (clientX: number, clientY: number) => {
      if (this.gameOver || !this.canDrop) return;
      const p = this.toLogical(clientX, clientY);
      if (!this.inPlayfield(p.x, p.y)) return;
      this.pointerMode = 'aiming';
      this.aiming = true;
      this.aimX = this.clampAimX(p.x);
    };

    const onMove = (clientX: number, clientY: number) => {
      if (this.pointerMode !== 'aiming' || this.gameOver) return;
      const p = this.toLogical(clientX, clientY);
      if (!this.inPlayfield(p.x, p.y)) {
        this.pointerMode = 'cancelled';
        this.aiming = false;
        return;
      }
      this.aimX = this.clampAimX(p.x);
    };

    const onUp = () => {
      if (this.pointerMode === 'aiming' && !this.gameOver && this.canDrop) {
        this.dropFruit();
      }
      this.pointerMode = 'idle';
      this.aiming = false;
    };

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onDown(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => onUp());

    el.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        if (t) onDown(t.clientX, t.clientY);
      },
      { passive: false },
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        if (t) onMove(t.clientX, t.clientY);
      },
      { passive: false },
    );
    el.addEventListener(
      'touchend',
      (e) => {
        e.preventDefault();
        onUp();
      },
      { passive: false },
    );
    el.addEventListener(
      'touchcancel',
      () => {
        this.pointerMode = 'cancelled';
        this.aiming = false;
      },
      { passive: true },
    );
  }

  private dropFruit(): void {
    if (!this.canDrop || this.gameOver) return;
    this.canDrop = false;
    this.scoreMgr.resetChain();

    const x = this.clampAimX(this.aimX);
    const body = createFruitBody(x, DROP_Y, this.pendingLevel);
    // 轻微向下初速，避免贴顶
    Matter.Body.setVelocity(body, { x: 0, y: 2 });
    Matter.World.add(this.engine.world, body);

    this.pendingLevel = this.nextLevel;
    this.nextLevel = randomDropLevel();
    drawNextPreview(this.ui.nextCanvas, this.nextLevel);

    window.setTimeout(() => {
      if (!this.gameOver) this.canDrop = true;
    }, DROP_COOLDOWN_MS);
  }

  private restart(): void {
    hideGameOver(this.ui);
    this.gameOver = false;
    this.canDrop = true;
    this.aiming = false;
    this.pointerMode = 'idle';
    this.floatTexts = [];
    this.scoreMgr.reset();
    updateScoreHUD(this.ui, 0, this.scoreMgr.highScore);

    const fruits = this.engine.world.bodies.filter(isFruitBody);
    Matter.World.remove(this.engine.world, fruits);

    this.pendingLevel = randomDropLevel();
    this.nextLevel = randomDropLevel();
    drawNextPreview(this.ui.nextCanvas, this.nextLevel);
  }

  private update(dt: number): void {
    Matter.Engine.update(this.engine, dt);

    for (const ft of this.floatTexts) {
      ft.life -= dt;
      ft.y -= dt * 0.04;
    }
    this.floatTexts = this.floatTexts.filter((f) => f.life > 0);

    if (!this.gameOver) this.checkFailLine(dt);
  }

  /** 仅当已 sleep/基本静止的水果中心在红线上方持续 3 秒才判负 */
  private checkFailLine(_dt: number): void {
    const now = performance.now();
    let anyDanger = false;

    for (const body of this.engine.world.bodies) {
      const data = getFruitData(body);
      if (!data) continue;

      const settled =
        body.isSleeping ||
        (Math.abs(body.velocity.x) < 0.15 &&
          Math.abs(body.velocity.y) < 0.15 &&
          Math.abs(body.angularVelocity) < 0.05);

      const above = body.position.y < FAIL_LINE_Y;

      if (above && settled) {
        anyDanger = true;
        if (data.settledAtAbove == null) {
          data.settledAtAbove = now;
        } else if (now - data.settledAtAbove >= FAIL_HOLD_MS) {
          this.triggerGameOver();
          return;
        }
      } else {
        data.settledAtAbove = null;
      }
    }

    // 无危险水果时无需额外处理；anyDanger 可用于后续 HUD 警示
    void anyDanger;
  }

  private triggerGameOver(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.canDrop = false;
    this.aiming = false;
    updateScoreHUD(this.ui, this.scoreMgr.score, this.scoreMgr.highScore);
    showGameOver(this.ui, this.scoreMgr.score, this.scoreMgr.highScore);
  }

  private render(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.displayW, this.displayH);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    bg.addColorStop(0, '#fff8f2');
    bg.addColorStop(1, '#ffe4d4');
    ctx.fillStyle = bg;
    this.roundRect(0, 0, LOGICAL_W, LOGICAL_H, 16);
    ctx.fill();

    // 红线
    ctx.strokeStyle = 'rgba(230, 60, 50, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(12, FAIL_LINE_Y);
    ctx.lineTo(LOGICAL_W - 12, FAIL_LINE_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(230, 60, 50, 0.7)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('危险线', 14, FAIL_LINE_Y - 6);

    // 瞄准引导
    if (this.aiming && this.canDrop && !this.gameOver) {
      const def = getFruit(this.pendingLevel);
      const x = this.clampAimX(this.aimX);
      ctx.strokeStyle = 'rgba(120, 80, 60, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, DROP_Y + def.radius);
      ctx.lineTo(x, LOGICAL_H - 8);
      ctx.stroke();
      ctx.setLineDash([]);
      drawFruit(ctx, x, DROP_Y, def, 1);
    } else if (this.canDrop && !this.gameOver) {
      const def = getFruit(this.pendingLevel);
      drawFruit(ctx, this.aimX, DROP_Y, def, 1);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#5a3d2b';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('拖动瞄准，松手投放', LOGICAL_W / 2, DROP_Y - def.radius - 8);
      ctx.globalAlpha = 1;
    }

    // 水果
    for (const body of this.engine.world.bodies) {
      const data = getFruitData(body);
      if (!data) continue;
      const def = getFruit(data.level);
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      drawFruit(ctx, 0, 0, def, 1);
      ctx.restore();
    }

    // 飘分
    for (const ft of this.floatTexts) {
      ctx.globalAlpha = Math.max(0, ft.life / 700);
      ctx.fillStyle = '#e85d04';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.globalAlpha = 1;
    }

    // 边框
    ctx.strokeStyle = 'rgba(255, 150, 110, 0.55)';
    ctx.lineWidth = 3;
    this.roundRect(1.5, 1.5, LOGICAL_W - 3, LOGICAL_H - 3, 15);
    ctx.stroke();

    ctx.restore();
  }

  private resize(): void {
    const wrap = this.canvas.parentElement;
    const maxW = wrap ? wrap.clientWidth : window.innerWidth;
    const maxH = wrap ? wrap.clientHeight : window.innerHeight;
    const fit = Math.min(maxW / LOGICAL_W, maxH / LOGICAL_H);
    this.scale = fit;
    this.displayW = Math.floor(LOGICAL_W * fit);
    this.displayH = Math.floor(LOGICAL_H * fit);
    this.offsetX = (this.displayW - LOGICAL_W * fit) / 2;
    this.offsetY = (this.displayH - LOGICAL_H * fit) / 2;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.displayW * dpr);
    this.canvas.height = Math.floor(this.displayH * dpr);
    this.canvas.style.width = `${this.displayW}px`;
    this.canvas.style.height = `${this.displayH}px`;
  }

  private toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.offsetX) / this.scale;
    const y = (clientY - rect.top - this.offsetY) / this.scale;
    return { x, y };
  }

  private inPlayfield(x: number, y: number): boolean {
    return x >= 0 && x <= LOGICAL_W && y >= 0 && y <= LOGICAL_H;
  }

  private clampAimX(x: number): number {
    const r = getFruit(this.pendingLevel).radius;
    return Math.max(r + 2, Math.min(LOGICAL_W - r - 2, x));
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
