# 软西瓜 Melt Melon (M1)

浏览器可玩的水果合成小游戏 (Suika)。后续目标：微信小游戏。

## 本地运行

1. 安装依赖：package script install
2. 启动开发服务：package script dev（端口 5173）
3. 构建：package script build / preview

浏览器打开 http://localhost:5173

## 玩法 (M1)

- 左右拖动瞄准，松手投放；拖出区域可取消
- 相同水果碰撞合成下一级，连消加分
- 水果中心在红线上方静止约 3 秒则游戏结束
- 最高分 localStorage 键：melt-melon-highscore

## 技术栈
- Vite + TypeScript + HTML Canvas
- Matter.js 刚体物理

## 微信小游戏
可导入工程见目录 [`wechatgame/`](./wechatgame/)（含 `project.config.json` + `game.json`）。
用微信开发者工具打开该目录即可预览；说明见 [`wechatgame/README.md`](./wechatgame/README.md)。
「揉软一下」软体效果为 M2，当前按钮为占位（禁用）。

## 仓库
https://github.com/edwardluozh/melt-melon
