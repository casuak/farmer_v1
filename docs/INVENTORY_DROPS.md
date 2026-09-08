# 物品拖出抛落与统一贴图

## 操作与表现

- 鼠标或触屏把整组物品拖到游戏场景，或点「丢下整组」：物品从角色身体弹起，朝面前约一格远抛落，落地轻轻回弹后静止。
- 飞行约 0.84 秒，期间不能拾取；落地后按 E / 互动按钮拾取，数量不变，沿用飞入物品栏动画。
- 连续丢弃使用独立飞行。装备和背包遵守原有卸下规则；有内容的背包不能丢弃。
- 检查完整路径和落点，绕开建筑、树、矿石和水边；无安全位置或在船上时不扣除物品。
- 打开面板暂停动画；关闭后继续。关闭「春日动态」会减弱上抛和回弹，不旋转。

## 生图资源

22 种物品全部使用本次 `openai/gpt-image-2` 生成的像素风美术，而非旧线框图标/通用地面礼盒。

- 原始图集：`docs/art/item-atlas-source.png`，6 列 × 4 行，最后两格为空。
- 透明底成品：`public/items/generated/*.png`，22 张 128 × 128 PNG；`manifest.json` 记录映射和来源。
- 导出工具：`node scripts/prepare-item-sprites.mjs docs/art/item-atlas-source.png`（需要项目现有 sharp）。去除品红背景并居中缩放，不需要重新调用生图。
- `components/game/itemSprites.ts` 是共用资源映射；`InventoryUI.tsx` 的物品栏、装备、商店、拖动预览和拾取模板全部复用。
- 地面渲染使用相同 PNG 的相机朝向透明面片、最近邻采样、真实深度遮挡，每种物品每场景共用一个材质/纹理；没有通用礼盒替代物。
- 钓鱼跃水/飞入动画也接入对应新鱼贴图。旧 fishSprites 中像素网格辅助函数保留用于旧资源验证。

## 验证

```text
npm run test:item-sprites
npm run test:inventory-drops
npm run test:inventory-drops:browser
npm run test:mining:hold
npm run test:mining:browser
npm run test:pickups
npm run test:pickups:browser
npm run test:fishing
npm run test:fishing:browser
npm run typecheck
npm run build
```

浏览器脚本使用现有 `http://127.0.0.1:5177`，不启动新服务器；可用第一个参数替换 URL。截图在 `.cache/inventory-drop-*.png`。

模型测试覆盖 22 种物品和 928 个真实世界位置/朝向组合（包括 276 个岸边/桥/码头组合），贴图测试覆盖全部 PNG 的透明通道、背景移除、图源一致性、接地、精确暂停和材质缓存。

本次已通过上述模型/贴图、类型检查、生产构建，以及真实 Chromium 的拖出、拾取、采矿、钓鱼回归。拖出测试包括桌面鼠标、390px 手机触摸、身体上抛、飞行中 E 不拾取、整组 24 颗种子回收、按钮/重复丢弃、暂停恢复、拖动取消、22 张图标加载和地面贴图同源；无运行时异常。生产构建仍有原有的大分块提示。
