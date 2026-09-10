import { drawFruit, getFruit } from './fruits';

export interface UIElements {
  score: HTMLElement;
  highscore: HTMLElement;
  energy: HTMLElement;
  overlay: HTMLElement;
  finalScore: HTMLElement;
  finalHigh: HTMLElement;
  nextCanvas: HTMLCanvasElement;
  btnRestart: HTMLButtonElement;
  btnOverlayRestart: HTMLButtonElement;
  btnSoft: HTMLButtonElement;
}

export function bindUI(): UIElements {
  const byId = <T extends HTMLElement>(id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el as T;
  };

  const soft = byId<HTMLButtonElement>('btn-soft');
  soft.disabled = true;
  soft.title = 'M2 软体';
  soft.classList.add('btn-disabled');

  return {
    score: byId('score'),
    highscore: byId('highscore'),
    energy: byId('energy'),
    overlay: byId('overlay'),
    finalScore: byId('final-score'),
    finalHigh: byId('final-high'),
    nextCanvas: byId<HTMLCanvasElement>('next-canvas'),
    btnRestart: byId<HTMLButtonElement>('btn-restart'),
    btnOverlayRestart: byId<HTMLButtonElement>('btn-overlay-restart'),
    btnSoft: soft,
  };
}

export function updateScoreHUD(ui: UIElements, score: number, high: number, energy = 100): void {
  ui.score.textContent = String(score);
  ui.highscore.textContent = String(high);
  ui.energy.textContent = String(energy);
}

export function showGameOver(ui: UIElements, score: number, high: number): void {
  ui.finalScore.textContent = String(score);
  ui.finalHigh.textContent = String(high);
  ui.overlay.classList.remove('hidden');
}

export function hideGameOver(ui: UIElements): void {
  ui.overlay.classList.add('hidden');
}

export function drawNextPreview(canvas: HTMLCanvasElement, level: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const size = 56;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const def = getFruit(level);
  const scale = Math.min(1, 20 / def.radius);
  drawFruit(ctx, size / 2, size / 2, def, scale);
}
