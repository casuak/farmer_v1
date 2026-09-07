# 拾取飞入物品栏

## 表现

- 地面物品按 E / 点击互动按钮拾取后，从实际物品中心轻轻弹起，沿弧线缩小飞入接收它的物品格。
- 飞行图案复用物品栏原图标，整组显示 `+数量`；到达时对应格子短暂柔光提示。
- 作物收获和 Boss 贝壳奖励也有飞入动画；采矿矿物改为先弹出落地，之后按 E 拾取时再飞入物品栏；钓鱼保留原有跃水入包动画。
- 支持叠堆、溢出分格、额外背包以及连续同时拾取。飞行期间整理物品会跟随实际新位置。
- 满包时不消耗地面物品，也不播放虚假的入包动画。
- 打开面板暂停、关闭后继续；减少动态时改为原地轻微上浮淡出和目标格提示。动画不拦截鼠标/触屏操作。

## 实现

- `components/game/inventory.ts`：`inventoryGains` 提供一次实际奖励前后的正向数量差，精确定位每个接收格。
- `components/game/droppedItems.ts`：原子拾取并返回回执，从现有模型获取世界坐标中心。
- `components/game/pickupMotion.ts`：0.18 秒弹起 + 0.60 秒弧线飞行；减少动态 0.22 秒。
- `components/game/pickupView.ts` / `pickup.css`：24 个复用 DOM 飞行节点、少量光点、实时目标格坐标和格子柔光；没有额外逐帧 React 更新或 WebGL 网格。
- `components/game/InventoryUI.tsx`：隐藏的同源图标模板和物品格 ID。
- `components/game/engine.ts`：拾取、采矿、收获、Boss 奖励的成功回执；暂停、重置和释放清理。

物品在成功拾取时即原子入包；动画只表达已提交的结果，暂停、重置、丢下物品或释放画面不会造成资源重复或丢失。

## 验证命令

```text
npm run test:pickups
npm run test:pickups:browser
npm run test:mining
npm run test:world
npm run test:beach-boss
npm run typecheck
npm run build
```

浏览器脚本使用现有 `http://127.0.0.1:5177`，不启动新游戏服务器；截图写入忽略的 `.cache/` 目录。支持 `CHROME_PATH` 指定 Chrome。

## 本次验证结果

- 拾取回执 / NullEngine / DOM 回归通过：新格、叠堆、三格溢出、额外背包、满包原子失败、实际地面中心、精确落点、24 节点复用和释放。
- 真实 Chromium 拾取脚本通过 7 次飞入：键盘 E、触屏、图案数量、到达格子高亮、重复按键无重复资源、途中整理重定向、暂停恢复、连续飞行、390px 手机和减少动态，无运行时异常。
- 挖矿后续更新：铜矿石 ×3 和石料 ×2 先弹出并留在地面，按 E 分别拾取时飞入物品栏；真实 Chromium 已验证长按鼠标 / F / E / 手机触屏开采、落地前后不自动入包、地面拾取和矿物丢下拾回。
- 世界回归、Boss 18 项及模型视觉测试、类型检查、修改模块专项 lint、生产构建和 `git diff --check` 均通过。构建仍有既有的大分块提示；未声称模板通用测试和全项目 lint 全部通过。
