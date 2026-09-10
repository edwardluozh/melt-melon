# 软西瓜 Melt Melon — 微信小游戏（M1）

本目录为可直接用 **微信开发者工具** 打开的小游戏工程，由仓库根目录的 Vite+Matter 浏览器版移植而来。

## 用微信开发者工具打开

1. 安装并打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 选择 **小游戏** → **导入项目**（或「+」新建时选导入）
3. **目录** 选到本文件夹：`melt-melon/wechatgame/`（需包含 `project.config.json` 与 `game.json`）
4. AppID 可使用测试号 / `touristappid`（游客模式），或填入你自己的小游戏 AppID
5. 编译类型应为 **游戏**（`compileType: game`）
6. 点击编译 / 预览即可在模拟器中试玩

## 玩法（与浏览器 M1 一致）

- 手指左右拖动瞄准，松手投放；拖出场地可取消
- 相同水果碰撞合成下一级，连消加分
- 水果中心在危险线上方静止约 3 秒则游戏结束
- 「揉软一下」为 M2 占位，当前禁用
- 最高分键名：`melt-melon-highscore`（`wx.getStorageSync` / `setStorageSync`）

## 目录说明

```
wechatgame/
  project.config.json          # 工程配置（compileType: game）
  project.private.config.json  # 本地私有配置（可选）
  game.json                    # 竖屏等小游戏配置
  game.js                      # 入口：创建并启动 Game
  js/
    matter.min.js              # 自 node_modules 拷贝的 Matter.js
    fruits.js                  # 水果阶梯与绘制
    physics.js                 # 引擎 / 墙体 / 刚体
    merge.js                   # 合成逻辑
    score.js                   # 得分与本地最高分
    game-core.js               # 主 Game 类（wx Canvas + 触摸）
  README.md
```

## 适配说明

- 渲染：`wx.createCanvas()` 主画布；无 DOM，HUD / 按钮 / 结算层均画在 canvas 上
- 触摸：`wx.onTouchStart` / `Move` / `End` / `Cancel`
- 动画：`requestAnimationFrame`
- 存储：`wx.getStorageSync` / `wx.setStorageSync`
- 物理：CommonJS `require('./matter.min.js')`

## 注意

- 请勿用本目录覆盖根目录浏览器工程；两边相互独立
- 真机预览需合法 AppID；游客模式仅限开发者工具模拟器
