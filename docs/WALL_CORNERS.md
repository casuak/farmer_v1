# 室内墙角黑块修正

## 原因

四角装饰柱和前墙合并后以 0.11 透明度显示，重叠体素盒会叠加残影；屋顶同样由重叠盒组成。后面 L 形墙的整体包围盒还会把室内空区域误判为遮挡，降到 0.19。淡出的墙/屋顶仍投实心太阳阴影，形成不应有的角柱黑块。

## 修改

- 当前房间后墙保持完整不透明，不再被整体包围盒误淡出。
- 当前房间前墙及屋顶精确隐藏（visibility=0），不保留多层透明盒的残影。渐变接近 0/1 时吸附到端点。
- 只从太阳阴影绘制中排除当前房间的隐藏前墙/屋顶；家具、角色、后墙、室外其它建筑仍保留正常阴影。走出房间恢复。
- 不移除物理几何、不禁用网格、不更改全局阴影强度；手电仍保留真实墙体和门洞遮光。

实现：`buildings.ts`、`roomCutaway.ts`、`engine.ts`。

## 验证

```text
npx esbuild scripts/verify-wall-corners.ts --bundle --platform=node --format=esm --outfile=.cache/verify-wall-corners.mjs
node .cache/verify-wall-corners.mjs
node scripts/verify-wall-corners-browser.mjs http://127.0.0.1:5177 after
npm run test:world
npm run test:flashlight
npm run typecheck
npm run build
```

浏览器对照使用现有 5177，截图在 `.cache/wall-corners-*.png`。修复前关闭阴影、强制前墙透明度0的独立A/B确认问题来源；修复后后墙1、前墙0、屋顶0，后角黑像素由78变0，前墙额外强制隐藏不再改变角落像素。室外恢复实心外观和太阳投影，保留人物/家具阴影。
