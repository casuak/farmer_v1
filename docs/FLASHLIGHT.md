# 手电筒工具

- 初始物品栏第 9 格赠送一支，按 **9** 或点击物品格手持，自动照亮前方；无需额外开关、电池或消耗。
- 桌面鼠标控制照射朝向，移动时保持照向光标；触屏随角色移动方向转向。
- 切换工具、丢弃、上船或翻滚收起工具时立即将光强归零；重新手持时先准备灯头姿态和阴影，再用约0.12秒平滑点亮。打开面板暂停时光束保持稳定。
- 可以拖出掉落、按 E 拾回，地面掉落图与物品栏共用透明 PNG。杂货店 50 G 购买，18 G 出售。
- 将右上时间滑块调到夜晚，前向暖白照明效果更明显。

## 实现

- `components/game/flashlight.ts`：单个真实 SpotLight，暖白、12 格范围、90°外锥与20阶角度衰减，形成柔和集中的前向光斑，边缘和距离渐暗；光源跟随真实灯头。
- 灯光始终保持注册，关闭仅改变光强，不反复重建材质灯光列表；初始化时同步灯光排序，避免切换引发编译/灯位变动。逻辑开关使用 `active` / `canvas.dataset.flashlightEnabled`，不再以底层 `light.isEnabled()` 判断是否发光。
- 使用高灯光优先级确保进入现有材质灯光预算；512px Poisson 局部阴影只选附近墙体/树干/矿石，最多24个投影物，不把整张地图重新画进手电阴影。
- 墙体遮挡和灯头穿墙保护；关闭全局阴影时以保守距离截断防止照穿整栋建筑，此低配模式下靠墙照射距离会缩短。
- `farmView.ts` / `character.ts`：手持体素模型、灯头和稳定握持姿态；`engine.ts`：工具选择、方向、灯光更新及释放。
- 生图原稿 `docs/art/flashlight-source.png`；成品 `public/items/generated/flashlight.png`，与其它物品统一为128px透明图标。重导出：`node scripts/prepare-flashlight-sprite.mjs`。

## 验证

```text
npm run test:flashlight
npm run test:flashlight:browser
npm run test:flashlight:switch
npm run test:flashlight:switch:browser
npm run test:item-sprites
npm run test:inventory-drops
npm run test:pickups
npm run test:world
npm run typecheck
npm run build
```

浏览器脚本使用现有 `http://127.0.0.1:5177`，不启动新服务器；截图输出到 `.cache/flashlight-*.png`。

验证结果：手电模型、23种贴图、物品掉落模型、拾取、世界回归、类型检查和生产构建通过；真实Chromium手电测试通过开关、鼠标转向、午夜照明、暂停、丢弃/拾回及390px触屏方向。固定场景开关光强对比，前方平均增亮67.63（0–255亮度），后方差1.01，无运行时异常。GPU实测发现聚光PCF阴影导致网格不显示，已改Poisson并验证恢复。构建仍有原有的大分块提示。
