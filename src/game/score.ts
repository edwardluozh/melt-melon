const HIGH_SCORE_KEY = 'melt-melon-highscore';

export class ScoreManager {
  score = 0;
  highScore = 0;
  private chain = 0;

  constructor() {
    this.highScore = this.loadHigh();
  }

  reset(): void {
    this.score = 0;
    this.chain = 0;
  }

  /** 合成得分：基础分 * 连消加成 */
  addMerge(baseScore: number): number {
    this.chain += 1;
    const bonusMul = 1 + (this.chain - 1) * 0.5;
    const gained = Math.round(baseScore * bonusMul);
    this.score += gained;
    this.persistHigh();
    return gained;
  }

  resetChain(): void {
    this.chain = 0;
  }

  getChain(): number {
    return this.chain;
  }

  private loadHigh(): number {
    try {
      const raw = localStorage.getItem(HIGH_SCORE_KEY);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }

  private persistHigh(): void {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try {
        localStorage.setItem(HIGH_SCORE_KEY, String(this.highScore));
      } catch {
        /* ignore quota / private mode */
      }
    }
  }
}
