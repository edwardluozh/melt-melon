# 软西瓜 Melt Melon — 微信小游戏（软体物理）

本目录为可直接用 **微信开发者工具** 打开的小游戏工程。水果使用 SoftWorld 软体（XPBD 膜 + 压力），非 Matter 刚体圆。

## 用微信开发者工具打开

1. 安装并打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 选择 **小游戏** → **导入项目**（或「+」新建时选导入）
3. **目录** 选到本文件夹：`melt-melon/wechatgame/`（需包含 `project.config.json` 与 `game.json`）
4. AppID 可使用测试号 / `touristappid`（游客模式），或填入你自己的小游戏 AppID
5. 编译类型应为 **游戏**（`compileType: game`）
6. 点击编译 / 预览即可在模拟器中试玩

## 玩法

- 手指左右拖动瞄准，松手投放
- 相同水果接触合成下一级；合成出最高级「西瓜角」时本局西瓜数 +1
- 顶部 HUD：左侧西瓜图标 + 本局数量；右侧仅「重新开始」
- 水果质心在危险线上方静止约 3 秒则游戏结束
- 历史最佳西瓜数键名：`melt-melon-melon-high`（结算页展示；`wx.getStorageSync` / `setStorageSync`）

## 目录说明

```
wechatgame/
  project.config.json
  game.json
  game.js                      # 入口
  js/
    soft-world.js              # SoftWorld 软体物理
    physics.js                 # 场地常量 + SoftWorld 工厂
    fruits.js                  # 水果阶梯 / 精灵 / 软体裁剪绘制
    merge.js                   # SoftWorld contacts 合成
    score.js                   # 本局 / 历史西瓜计数
    game-core.js               # 主 Game（Canvas + 触摸）
    matter.min.js              # 未使用（可删）
  README.md
```

## 适配说明

- 渲染：`wx.createCanvas()`；HUD / 按钮 / 结算层均画在 canvas 上
- 触摸：`wx.onTouchStart` / `Move` / `End` / `Cancel`
- 主循环：`setInterval`（开发者工具 rAF 不稳定）
- 物理：`js/soft-world.js`（POINT_COUNT=16, FIXED_STEP=1/60, SOLVER_PASSES=4）
- 绘制：对 soft hull `clip()` 后贴水果 PNG

## 注意

- 请勿用本目录覆盖根目录浏览器工程；两边相互独立
- 真机预览需合法 AppID；游客模式仅限开发者工具模拟器
