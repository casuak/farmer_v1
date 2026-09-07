# 森林采矿与背景音乐

## 玩法

- 初始第 8 格为矿镐；按 `8` 或点击物品格装备。
- 青苔森林沿林道分布 12 处矿点，地图上以彩色菱形标记。铜矿 3 镐、铁矿 4 镐、晶石 5 镐。
- 走近矿点（中心 2.15 米内），按住鼠标左键点矿石或面向矿石按住F，即可连续挥镐。按住 `E` / 触屏互动按钮也可自动装备矿镐并连续开采。松开只完成当前一镐，不再起手；`Esc`、切工具、面板或失焦立即取消。
- 每镐 0.72 秒，0.38 秒命中；包含抬镐、下砸、回弹，命中闪光、裂纹、矿屑、尘雾与独立矿石音效。
- 打开面板或失去焦点取消未完成的挥镐。命中后不会重复发放资源。
- 矿脉碎裂后，矿石和石料分别从矿体弹出，沿弧线落到玩家附近可达地面并小幅弹跳；落稳后按 `E` 拾取，继续沿用飞入物品栏动画。满包时物品一直保留在地面。矿物可出售，矿镐可在杂货店补购。
- 采空矿点约 120 秒后恢复，玩家未离开时不会在脚下重新生成碰撞。
- 背景音乐为 Kevin MacLeod 的 **Dream Culture**，首次真实点击/按键后以 22% 音量循环。画面设置中有独立背景音乐开关、音乐音量和署名；切到后台暂停，返回后续播。原曲文件与 CC BY 4.0 署名在 `public/audio/`。

## 实现入口

- `components/game/mining.ts`：矿点配置、可达校验、挥镐状态机、掉落与恢复。
- `components/game/miningMotion.ts` / `character.ts` / `farmView.ts`：时间契约、角色骨骼动作与矿镐模型。
- `components/game/miningView.ts`：矿石、分段裂纹、固定数量粒子、镐头轨迹与选中圈。
- `components/game/miningInput.ts`：多输入长按锁定同一矿脉；完成回弹后续镐，松手/中断清除。
- `components/game/droppedItems.ts` / `groundDropMotion.ts`：真实矿物堆弹出、安全落点、重力弧线与落地弹跳；空中禁止拾取，落稳后原子入包。
- `components/game/music.ts`：单实例本地音乐循环与浏览器音频生命周期。
- `components/game/engine.ts` / `FarmGame.tsx`：游戏输入、资源入包、音乐设置与 UI 集成。

## 验证命令

```text
npm run typecheck
npm run test:world
npm run test:mining
npm run test:mining:hold
npm run test:music
npm run test:mining:browser
npm run test:music:browser
npm run build
```

浏览器脚本使用现有 `http://127.0.0.1:5177`，不会启动替代服务器。可将实际预览地址作为脚本参数；需要本地 Chrome，可通过 `CHROME_PATH` 指定。截图输出到忽略目录 `.cache/`。

## 验证边界

类型检查、游戏世界回归、挖矿及音乐专项测试、生产构建已通过。长按更新通过纯模型 3/4/5 连镐测试、全部 12 矿脉共 284 个站位的安全落点验证、弹出/下落/回弹/落稳以及满包拾取不丢失检查。

挖矿在真实 Chromium/WebGL 中通过短按单镐、持续鼠标两镐、F/E 长按与松开、切工具/面板取消、空中暂停、落稳后手动拾取飞入、无重复掉落/自动换矿、矿物丢下拾回及手机持续触屏两镐检查。拾取与长剑浏览器回归也通过，无运行时异常。

音乐在相同现有预览通过真实 Chromium 检查：手势前无播放、首次按键解锁、单个本地 Audio 元素、214.36 秒可解码曲目、播放时间前进、跳到末尾后循环回绕、音乐开关、键盘调节音量 0 暂停 / 非零续播、关闭音效仍播放音乐、可见性事件暂停/续播，且无运行时异常。背景可见性采用测试脚本触发的 visibilitychange；声音解锁使用真实 CDP 输入。

项目通用 `node --test tests/*.test.mjs` 仍有两项与本功能无关的模板契约失败：`codex-preview=development` 元信息缺失，以及未用到的 `scrollbar-width:none` 样式未输出；本次没有修改页面元信息或全局 Tailwind 配置来绕过这些断言。`FarmGame.tsx` 还有原有的 React hooks/ref lint 诊断；新加模块及其余本次修改的游戏系统专项 lint 通过。
