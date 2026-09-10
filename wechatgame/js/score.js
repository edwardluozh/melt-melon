/**
 * 得分与最高分（wx 本地存储）
 */
var HIGH_SCORE_KEY = 'melt-melon-highscore';

function ScoreManager() {
  this.score = 0;
  this.highScore = 0;
  this._chain = 0;
  this.highScore = this._loadHigh();
}

ScoreManager.prototype.reset = function () {
  this.score = 0;
  this._chain = 0;
};

/** 合成得分：基础分 * 连消加成 */
ScoreManager.prototype.addMerge = function (baseScore) {
  this._chain += 1;
  var bonusMul = 1 + (this._chain - 1) * 0.5;
  var gained = Math.round(baseScore * bonusMul);
  this.score += gained;
  this._persistHigh();
  return gained;
};

ScoreManager.prototype.resetChain = function () {
  this._chain = 0;
};

ScoreManager.prototype.getChain = function () {
  return this._chain;
};

ScoreManager.prototype._loadHigh = function () {
  try {
    var raw = wx.getStorageSync(HIGH_SCORE_KEY);
    var n = raw !== '' && raw != null ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch (e) {
    return 0;
  }
};

ScoreManager.prototype._persistHigh = function () {
  if (this.score > this.highScore) {
    this.highScore = this.score;
    try {
      wx.setStorageSync(HIGH_SCORE_KEY, String(this.highScore));
    } catch (e) {
      /* ignore */
    }
  }
};

module.exports = {
  ScoreManager: ScoreManager,
  HIGH_SCORE_KEY: HIGH_SCORE_KEY,
};
