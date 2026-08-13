import fs from "node:fs/promises";
import path from "node:path";
import type { StoryDocument } from "../src/types.js";

const ROOT_DIR = path.resolve(process.cwd(), "..");
const STORIES_DIR = path.join(ROOT_DIR, "data", "stories");
const RUNS_DIR = path.join(ROOT_DIR, "data", "runs");

const THEMES: Array<{ id: string; pattern: RegExp }> = [
  { id: "visa", pattern: /visa|permit|immigra|consulate|embassy|residence|registration|arrival|coe|签证|居留|入境|登记/i },
  { id: "housing", pattern: /housing|house|dorm|rent|apartment|commute|accommodation|住房|宿舍|租房|通勤/i },
  { id: "money", pattern: /money|fund|tuition|deposit|bank|finance|scholarship|payment|cost|钱|资金|学费|押金|奖学金/i },
  { id: "language", pattern: /language|german|english|chinese|communication|integration|语言|德语|英语|沟通/i },
  { id: "career", pattern: /career|job|work|intern|employ|recruit|求职|工作|实习|就业/i },
  { id: "wellbeing", pattern: /wellbeing|health|insurance|burnout|social|isolation|stress|医疗|保险|健康|压力|孤独/i },
  { id: "time", pattern: /time|deadline|delay|late|disruption|时间|截止|延期|迟到/i },
  { id: "school", pattern: /school|study|program|course|academic|exam|graduat|thesis|specialization|学校|课程|学业|考试|毕业|论文/i },
  { id: "network", pattern: /network|mentor|advisor|professor|lab|research|alumni|人脉|导师|教授|实验室|科研|校友/i },
];

const NODE_ID_THEMES: Array<{ id: string; pattern: RegExp }> = [
  { id: "money", pattern: /deposit|tuition|payment|fund|money|scholarship/i },
  { id: "housing", pattern: /housing|house|dorm|rent|commute|accommodation/i },
  { id: "visa", pattern: /visa|permit|immigra|consulate|embassy|residence|registration|arrival|bureaucr/i },
  { id: "language", pattern: /language|german|english|communication|integration/i },
  { id: "career", pattern: /career|job|part_time|intern|employ|recruit/i },
  { id: "wellbeing", pattern: /wellbeing|health|insurance|burnout|social|isolation|stress/i },
  { id: "time", pattern: /time|deadline|delay|late|disruption|crunch/i },
  { id: "network", pattern: /network|mentor|advisor|professor|lab|research|alumni/i },
  { id: "school", pattern: /offer_acceptance|school|study|program|course|academic|exam|graduat|thesis|specialization|final_choice/i },
];

type VisualPage = StoryDocument["nodes"][string] | StoryDocument["endings"][string];

const RECOVERY_MOTIFS: Array<{ id: string; pattern: RegExp }> = [
  { id: "bird", pattern: /鸽|鸟|纸鹤|天鹅|pigeon|bird|crane|swan/i },
  { id: "otter", pattern: /水獭|otter/i },
  { id: "animal", pattern: /土拨鼠|猫|狗|动物|marmot|cat|dog|animal/i },
  { id: "dream", pattern: /梦|醒|睡|nightmare|dream|wake/i },
  { id: "portal", pattern: /虫洞|黑洞|旋涡|漩涡|传送门|次元|平行宇宙|wormhole|black hole|portal|dimension/i },
  { id: "printer", pattern: /打印机|碎纸机|printer|shredder/i },
  { id: "clock", pattern: /闹钟|时钟|秒针|clock|alarm/i },
  { id: "document", pattern: /护照|签证|申请表|成绩单|简历|拒信|passport|visa|form|transcript|resume/i },
  { id: "magic", pattern: /幽灵|魔法|怪兽|书灵|雕像|ghost|magic|monster|spirit|statue/i },
  { id: "alien", pattern: /外星|飞船|alien|spaceship/i },
];

const FRESH_RECOVERIES = [
  ["校历夹住了这一页", "校园电子校历忽然弹出一枚“恢复草稿”图钉。你点了一下，今天像被翻错的纸页轻轻折回{previous_node}；校历还假装这只是普通同步。", "收好这枚图钉，重新选择"],
  ["食堂托盘开始倒带", "食堂传送带突然反向运转，托盘、咖啡和刚才的坏决定依次退场。等它停下，你已经稳稳站在{previous_node}，手里多了一张“本次纠错免单”小票。", "端好托盘，再想一次"],
  ["电梯多出一个昨天按钮", "校园电梯的楼层键集体熄灭，只留下一个写着“刚才”的按钮。门再打开时，走廊已经恢复成{previous_node}，电梯则若无其事地播放起轻音乐。", "走出电梯，换个决定"],
  ["图书归还口退回了昨天", "图书馆归还口拒收这个结局，反而吐出一本名为《刚才可以重选》的书。你一翻开，书页便把四周折回{previous_node}。", "合上书，重写这一页"],
  ["咖啡拉花画出了撤销箭头", "杯里的咖啡拉花突然转成一枚撤销箭头，桌面随香气慢慢倒回{previous_node}。店员看了一眼，只说今天的特调确实有点超出配方。", "喝口咖啡，清醒地重选"],
  ["校园巴士宣布临时改线", "校园巴士广播忽然宣布：“下一站，刚才。”车窗外的街景倒着掠过，车门打开时正好是{previous_node}；司机拒绝透露这条线的运营许可。", "下车回到上一步"],
  ["门禁卡刷开了几分钟前", "你的学生门禁卡在读卡器上发出一声格外自信的“嘀”。门后不是房间，而是几分钟前的{previous_node}；系统记录里只留下一行“访问已纠正”。", "收好门禁卡，再做判断"],
  ["云端备份找回了旧版本", "屏幕右下角悄悄提示：“发现一个更适合继续的人生版本。”你确认恢复，四周便从云端备份加载成{previous_node}，进度条还礼貌地向你鞠了一躬。", "载入旧版本，重新决定"],
] as const;

function recoveryMotif(text: string): string {
  return RECOVERY_MOTIFS.find((motif) => motif.pattern.test(text))?.id ?? "other";
}

function diversifyRecoveries(doc: StoryDocument): number {
  const pages = [...Object.entries(doc.nodes), ...Object.entries(doc.endings)] as Array<[string, VisualPage]>;
  const motifCounts = new Map<string, number>();
  let changed = 0;
  for (const [index, [, page]] of pages.filter(([, page]) => Boolean(page.failure_recovery)).entries()) {
    const recovery = page.failure_recovery!;
    const motif = recoveryMotif(`${recovery.title} ${recovery.scene_text}`);
    if (motif !== "other" && (motifCounts.get(motif) ?? 0) >= 2) {
      const replacement = FRESH_RECOVERIES[index % FRESH_RECOVERIES.length];
      page.failure_recovery = { title: replacement[0], scene_text: replacement[1], return_choice_text: replacement[2] };
      changed += 1;
      motifCounts.set("other", (motifCounts.get("other") ?? 0) + 1);
    } else {
      motifCounts.set(motif, (motifCounts.get(motif) ?? 0) + 1);
    }
  }
  return changed;
}

function themeOf(id: string, page: VisualPage): string | null {
  const idTheme = NODE_ID_THEMES.find((theme) => theme.pattern.test(id));
  if (idTheme) return idTheme.id;
  const text = `${id} ${page.scene_text} ${page.image_prompt ?? ""}`;
  return THEMES.find((theme) => theme.pattern.test(text))?.id ?? null;
}

function rebalance(doc: StoryDocument): { changed: number; uniqueBefore: number; uniqueAfter: number } {
  const all = [...Object.entries(doc.nodes), ...Object.entries(doc.endings)] as Array<[string, VisualPage]>;
  const uniqueBefore = new Set(all.map(([, page]) => page.image_url).filter(Boolean)).size;
  const warningImages = new Map<string, string[]>();
  const fallbackImages = new Map<string, string[]>();
  for (const [id, page] of all) {
    if (!page.image_url || (page.logic_page_role !== "warning" && page.logic_page_role !== "failure" && !(id in doc.endings))) continue;
    const theme = themeOf(id, page);
    if (!theme) continue;
    const target = page.logic_page_role === "warning" ? warningImages : fallbackImages;
    const list = target.get(theme) ?? [];
    if (!list.includes(page.image_url)) list.push(page.image_url);
    target.set(theme, list);
  }

  let changed = 0;
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.logic_page_role !== "node") continue;
    const theme = themeOf(id, node);
    const candidates = theme ? (warningImages.get(theme)?.length ? warningImages.get(theme) : fallbackImages.get(theme)) : undefined;
    if (!candidates?.length) continue;
    const seed = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const selected = candidates[seed % candidates.length];
    if (node.image_url !== selected) {
      node.image_url = selected;
      changed += 1;
    }
    for (const choice of node.choices) {
      const result = doc.nodes[choice.next_node];
      if (result?.logic_page_role === "result" && result.image_url !== selected) {
        result.image_url = selected;
        changed += 1;
      }
    }
  }
  const uniqueAfter = new Set(all.map(([, page]) => page.image_url).filter(Boolean)).size;
  return { changed, uniqueBefore, uniqueAfter };
}

for (const storyId of process.argv.slice(2)) {
  const storyPath = path.join(STORIES_DIR, `${storyId}_final.json`);
  const doc = JSON.parse(await fs.readFile(storyPath, "utf8")) as StoryDocument;
  const report = rebalance(doc);
  const recoveryChanged = diversifyRecoveries(doc);
  const output = `${JSON.stringify(doc, null, 2)}\n`;
  await fs.writeFile(storyPath, output, "utf8");
  const runFinal = path.join(RUNS_DIR, storyId, "09_final_story.json");
  await fs.writeFile(runFinal, output, "utf8").catch(() => undefined);
  console.log(JSON.stringify({ storyId, ...report, recoveryChanged }));
}
