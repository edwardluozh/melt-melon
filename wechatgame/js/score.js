/**
 * 大西瓜计数（本局 melonCount；历史最高存 melt-melon-melon-high）
 */
var MELON_HIGH_KEY = 'melt-melon-melon-high';

function ScoreManager() {
  this.melonCount = 0;
  this.melonHigh = this._loadHigh();
}

ScoreManager.prototype.reset = function () {
  this.melonCount = 0;
};

/** 合成出最高级水果时 +1，并刷新历史最高 */
ScoreManager.prototype.addMelon = function () {
  this.melonCount += 1;
  this._persistHigh();
  return this.melonCount;
};

ScoreManager.prototype._loadHigh = function () {
  try {
    var raw = wx.getStorageSync(MELON_HIGH_KEY);
    var n = raw !== '' && raw != null ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch (e) {
    return 0;
  }
};

ScoreManager.prototype._persistHigh = function () {
  if (this.melonCount > this.melonHigh) {
    this.melonHigh = this.melonCount;
    try {
      wx.setStorageSync(MELON_HIGH_KEY, String(this.melonHigh));
    } catch (e) {
      /* ignore */
    }
  }
};

module.exports = {
  ScoreManager: ScoreManager,
  MELON_HIGH_KEY: MELON_HIGH_KEY,
};
