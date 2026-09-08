# 夜间手电切换防闪烁

## 修正方向

之前切换工具时直接对 SpotLight 调用 setEnabled，会改变每个接收材质的灯光列表/着色器定义；新灯位、旧手部姿态和未更新的阴影图还可能在同一帧混用。

- 始终注册同一盏零强度灯，关闭时光强为0，不重排接收材质里的灯光列表、不切换阴影采样类型。
- 一次性同步灯光优先级，固定手电在材质灯光预算内的位置。
- 状态发布只处理装备选择，不使用上一种工具的手部姿态点亮。
- 开启时先刷新当前灯头位置、方向和附近遮挡物，实际阴影图完成绘制后再开始约0.12秒渐亮。
- 快速关开会废弃上一轮的阴影就绪状态；取消、丢弃、翻滚、上船立即归零，不留下亮一帧的旧光束。
- 关闭时不重复绘制阴影图；暂停时不推进渐亮，不因状态发布重新启动。
- 保持512px Poisson阴影和已有室内切面/墙体遮光，不通过关闭全局阴影或增减曝光来掩盖问题。

`flashlight.active` / `canvas.dataset.flashlightEnabled` 表示逻辑装备状态。底层 `light.isEnabled()` 保持true，用于稳定GPU材质结构，不表示正在发光。

## 验证

```text
npm run test:flashlight
npm run test:flashlight:switch
npm run test:flashlight:switch:browser
npm run test:flashlight:browser
npm run test:wall-corners
npm run test:wall-corners:browser
npm run typecheck
npm run build
```

真实浏览器测试使用现有 `http://127.0.0.1:5177`，验证夜间反复切换过程中的光强、材质/灯光列表稳定性与帧亮度；不启动新游戏服务器。
