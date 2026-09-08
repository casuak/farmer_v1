# 每镐弹出矿石

- 每次镐头真正命中矿脉时，立即生成 **1 颗对应矿石**，从矿脉处弹起、沿弧线落下并轻轻回弹。不必等矿脉挖空。
- 每一颗都有独立的掉落动画和落点，连续长按挖矿不会吞掉之前的动画；矿脉仍存在时，落点避开它的碰撞区域。
- 最后一镐仍掉 1 颗矿石，另保留碎石副产物。不再重复发放整组矿石。
- 铜矿 3 镐：铜矿石 3 颗 + 石料 2；铁矿 4 镐：铁矿石 4 颗 + 石料 3；晶簇 5 镐：晶石 5 颗 + 石料 2。
- 仅成功命中才掉落。取消、空挥、超出距离、切换工具、同一挥镐的后续帧均不重复出矿。
- 矿石落稳后按 E 拾取；不会自动进包，满包也不会让地面矿石消失。暂停时动画停止，关闭动态效果时减弱上抛和回弹。

实现：`mining.ts` 每击奖励回执；`engine.ts` 每次成功命中调用 `GroundItems.eject`；`droppedItems.ts` 在之前落点附近避让，复用物品栏PNG和已有落地动画。

验证命令：

```text
npm run test:mining
npm run test:mining:hold
npm run test:mining:per-hit
npm run test:mining:per-hit:browser
npm run test:world
npm run test:inventory-drops
npm run typecheck
npm run build
```

模型验证通过：12 个矿点、284 个可达方位、1090 次有效命中，其中806次矿脉尚未挖空；逐击奖励、独立飞行、安全落点和数量守恒均通过。

真实Chromium测试通过：三次单击与一次长按 F 的每击独立上抛/下降/落地、取消未命中无掉落、暂停450ms精确冻结、四次 E 拾回铜矿3颗和石料2、地面PNG同源，无运行时异常。截图和报告位于 `.cache/mining-per-hit/`。

新浏览器测试使用既有 `http://127.0.0.1:5177`，不启动游戏服务器。旧 `verify-mining-browser.mjs` 中“破矿才一次出矿”和已删除 E 按钮的旧 UI 流程不再适用，新逐击测试覆盖当前交互。
