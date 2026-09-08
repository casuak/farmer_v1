import type { DialogueChoice, DialogueNode, DialogueScript, DialogueSpeaker } from "./dialogue";

type Topic = { id: string; label: string; lines: string[]; followup: string; details: string[] };
type ResidentContent = { welcome: [string, string]; goodbye: string; topics: [Topic, Topic] };

const residents: Record<string, ResidentContent> = {
  "莉芙": {
    welcome: ["早呀，农场那边还顺利吗？春天的泥土闻起来真好。", "不用急着把田种满。照顾好一小片，也会有很开心的收成。"],
    goodbye: "慢慢来，记得给自己也留一点休息的时间。回头见！",
    topics: [
      {
        id: "farm", label: "聊聊种田", followup: "收成之后呢？",
        lines: ["先翻好地，再播种、浇水。看着嫩芽冒出来，是我最喜欢的事。", "出门前绕田地走一圈吧，别让忙碌的小农夫忘了浇水。"],
        details: ["成熟的作物收进背包后，可以留着，也可以带去杂货店卖。", "带上收成去店里逛逛吧，说不定正好能换成下一袋种子。"],
      },
      {
        id: "shop", label: "杂货店在哪里？", followup: "出门带点什么？",
        lines: ["广场旁那座绿屋顶的小屋，就是松果杂货店。", "直接走进屋里，再按 E 交易。种子和背包都值得留意。"],
        details: ["先想想今天要种什么，再给背包留几格空位。", "路上捡到的贝壳也别急着扔，带去店里看看吧。"],
      },
    ],
  },
  "阿松": {
    welcome: ["嘿，来吹海风啦？今天的浪声挺温柔。", "忙完农活以后，沿木栈道走走，肩膀都会轻一点。"],
    goodbye: "一路顺风。回来的时候，记得看看海上的夕阳。",
    topics: [
      {
        id: "harbor", label: "怎么去码头？", followup: "码头适合做什么？",
        lines: ["沿着海岸木栈道往南走，再朝海边拐，就能找到小船的码头。", "别只顾着低头赶路，远远看见船影，就知道方向没错。"],
        details: ["可以去看看船，也可以沿岸找个喜欢的地方钓鱼。", "先整理好背包再出发，免得新收获来了却没地方放。"],
      },
      {
        id: "sea", label: "聊聊海边", followup: "有什么出行建议？",
        lines: ["我喜欢听木板被海风吹得轻轻响，像码头在哼歌。", "沙滩上偶尔有值得捡的东西，不过出门也要留神周围。"],
        details: ["别为了一个贝壳，硬闯让自己不安心的地方。", "遇到危险就先退开。海还在这里，明天也能再来。"],
      },
    ],
  },
  "米娅": {
    welcome: ["你来得正好，刚才又飘下来一片樱花。", "樱花开的季节，连海风都带着一点甜味。"],
    goodbye: "愿你今天的小收获，像花瓣一样装满口袋。下次见！",
    topics: [
      {
        id: "spring", label: "你最喜欢春天什么？", followup: "想找个地方散步", 
        lines: ["是那些很小的变化：新芽、花影，还有农田里多出来的一点绿。", "不一定每天都要完成好多事。停下来看看，也算认真过了一天。"],
        details: ["可以先在樱花树旁站一会儿，再往海边慢慢走。", "把手里的工具收一收吧，今天就让风给你带路。"],
      },
      {
        id: "farm", label: "农活忙不过来怎么办？", followup: "今天从哪里开始？",
        lines: ["先照顾眼前那一小片田，别把自己累坏了。", "种子不会因为你慢一点，就不愿意发芽。一步一步来呀。"],
        details: ["看看有没有成熟的作物，再检查需要浇水的土地。", "做完这两件小事，就可以奖励自己去海边散个步。"],
      },
    ],
  },
  "奥利": {
    welcome: ["嗨，准备去林间探险吗？先别急，检查一下装备。", "矿石值得找，但平平安安带回农场，才算一趟好冒险。"],
    goodbye: "量力而行，遇险先退。等你回来，我们再聊今天的见闻。",
    topics: [
      {
        id: "mining", label: "聊聊采矿", followup: "出发前检查什么？",
        lines: ["找到矿石以后，用镐慢慢敲，每敲中一镐就会掉出一颗。", "等它落稳再拾回来。弯腰之前，也看看周围安不安全。"],
        details: ["检查工具，再给背包留点空间，矿石可不会自己跑回家。", "如果附近还有怪物，先拉开距离处理危险，再回来收拾。"],
      },
      {
        id: "combat", label: "遇到史莱姆怎么办？", followup: "近身时要注意什么？",
        lines: ["林间空地里有史莱姆。带上手枪，可以一边后退一边射击。", "别只盯着准星，也看看脚下，给自己留一条退路。"],
        details: ["用剑时看准距离，不要一头冲进怪物堆里。能闪开就先闪开。", "村民可不是练习目标。收起武器再来打招呼，大家都会更安心。"],
      },
    ],
  },
  "艾达": {
    welcome: ["背包鼓鼓的？看来今天收获不错呀。", "我出门前总会整理口袋，这样遇见好东西就不用左右为难。"],
    goodbye: "把重要的东西收好，也给新的惊喜留个位置。回头见！",
    topics: [
      {
        id: "bag", label: "想换个大背包", followup: "买来就能用吗？",
        lines: ["帆布背包只要 120 金币，穿上就多 8 格位置。", "去杂货店看看吧。换个宽敞的背包，出门也能轻松些。"],
        details: ["当然，店里买好帆布背包就会自动装备，不用再动手换。", "多出来的空间也别一下塞满，留几格给路上的意外收获。"],
      },
      {
        id: "packing", label: "怎么整理背包？", followup: "出远门带什么？",
        lines: ["把今天要用的工具和材料先理清楚，不需要随身带的就先安置好。", "想卖的作物、矿石和贝壳，去店里时一起处理会省心些。"],
        details: ["种田、钓鱼、采矿，先想好这一趟最想做什么。", "工具带对、空位留够，比把整个家装进口袋更轻松。"],
      },
    ],
  },
};

/** Content only: choices never grant money/items or call gameplay effects. */
export function dialogueFor(speaker: DialogueSpeaker): DialogueScript {
  if (speaker.panicking || speaker.injured) {
    const line = speaker.panicking ? "先别靠近……让我到安全的地方，好吗？" : "我还有点疼，想安静歇一会儿。我们下次再聊吧。";
    return { start: "rest", nodes: { rest: { id: "rest", lines: [line], next: null } } };
  }
  const content = Object.prototype.hasOwnProperty.call(residents, speaker.name) ? residents[speaker.name] : undefined;
  if (!content) {
    return { start: "fallback", nodes: { fallback: { id: "fallback", lines: [speaker.line?.trim() ? speaker.line : "你好呀，愿你今天在农场过得开心。"], next: null } } };
  }
  const menu: DialogueChoice[] = [
    ...content.topics.map(topic => ({ id: `topic-${topic.id}`, label: topic.label, next: topic.id })),
    { id: "goodbye", label: "先聊到这里，回头见", next: "goodbye" },
  ];
  const nodes: Record<string, DialogueNode> = {
    welcome: { id: "welcome", lines: [...content.welcome], choices: menu.map(choice => ({ ...choice })) },
    topics: { id: "topics", lines: ["还有什么想聊的吗？我听着呢。"], choices: menu.map(choice => ({ ...choice })) },
    goodbye: { id: "goodbye", lines: [content.goodbye], next: null },
  };
  for (const topic of content.topics) {
    nodes[topic.id] = {
      id: topic.id,
      lines: [...topic.lines],
      choices: [
        { id: `more-${topic.id}`, label: topic.followup, next: `${topic.id}-detail` },
        { id: "back", label: "再聊个别的话题", next: "topics" },
        { id: "goodbye", label: "谢谢，回头见", next: "goodbye" },
      ],
    };
    nodes[`${topic.id}-detail`] = { id: `${topic.id}-detail`, lines: [...topic.details], next: "topics" };
  }
  return { start: "welcome", nodes };
}
