import fs from "node:fs";
import path from "node:path";

const storyPaths = process.argv.slice(2);
if (storyPaths.length === 0) {
  throw new Error("Usage: node backend/scripts/backfillFailureRecoveries.mjs <story.json> [...]");
}

const chineseRecoveries = [
  ["期末噩梦拒绝续订", "你猛地从一场学业灾难片里惊醒，发现被子只是卷成了退学通知书的形状。手机还停在事发前，命运把书签塞回了{previous_node}。", "把被子叠好，再选一次"],
  ["外星教务处发来勘误", "你心灰意冷地出门散步，却被一艘迷路的飞船当成交换生接走。外星人核对材料后连声道歉，把你送回地球时，时钟已经倒退到{previous_node}。", "谢过外星教务处，回到上一步"],
  ["打印机承认自己会撤销", "打印机突然吐出一张写着“Ctrl+Z 也适用于人生”的纸，随后蓝光一闪。你再睁眼，已经站回{previous_node}，机器则假装自己从未选修过时间旅行。", "按下人生撤销键"],
  ["慕尼黑鸽子驳回结局", "一只表情严肃的鸽子叼走失败通知，绕着你飞了三圈，把时间线硬生生拧成回形针。世界停止旋转后，你又站在{previous_node}。", "接受鸽子的修改意见"],
  ["闹钟申请了时间补考", "你的闹钟对这个结局非常不满，当场向宇宙考试委员会申请补考。秒针倒着跑了一小圈，把你送回{previous_node}，还得意地响了两声。", "关掉闹钟，认真重选"],
  ["限制账户开了虫洞", "ATM 吐出的不是余额单，而是一张宇宙财务更正函。纸条卷成小小的虫洞，将你精准投递回{previous_node}；手续费居然是零。", "收好更正函，回到上一步"],
  ["护照打了个时间喷嚏", "护照听见坏消息后猛地打了个喷嚏，签证页飞出一阵闪亮的时间粉尘。等你擦干净桌面，自己已经回到{previous_node}。", "拍拍护照，再做决定"],
  ["公寓钥匙开错了年代", "你把钥匙插进门锁，门后却不是房间，而是几分钟前的世界。你跨过去，正好落在{previous_node}，钥匙一本正经地拒绝解释。", "关好时间门，重新选择"],
  ["教授在黑板上写了 Ctrl+Z", "空教室的黑板忽然自己写下一个巨大的 Ctrl+Z，粉笔灰像舞台烟雾般散开。你咳嗽两声，发现讲台已经变回{previous_node}。", "擦掉粉笔灰，重做这道题"],
  ["翻译软件纠正了命运", "翻译软件把“game over”认真翻成了“建议重试”，还擅自向时间服务器提交申诉。页面刷新后，你被退回{previous_node}。", "相信这次翻译，回到上一步"],
  ["招聘吉祥物兼职修时间线", "职业展的吉祥物摘下头套，严肃宣布它其实是兼职时间工程师。它敲了敲你的简历，四周便折叠回{previous_node}。", "向时间工程师道谢并重选"],
  ["校医室的盆栽按下暂停键", "校医室窗边的盆栽轻轻抖了抖叶子，替你按下宇宙暂停键。等呼吸重新平稳，时间也温柔地退回{previous_node}。", "先照顾好自己，再重新选择"],
  ["课程表偷偷存了读档点", "课程表从书包里探出一个角，小声承认自己一直保存着自动存档。你轻轻一碰，四周便像翻书一样翻回{previous_node}。", "读取课程表的存档"],
  ["简历折成纸飞机穿越了", "你的简历自动折成一架纸飞机，绕过所有已读不回，最后一头扎进时间裂缝。你追过去，正好落回{previous_node}。", "展开简历，重新规划"],
];

const englishRecoveries = [
  ["The deadline requests a retake", "Your alarm clock appeals the ending to the cosmic examination board. The second hand runs backward and deposits you at {previous_node}, looking unbearably pleased with itself.", "Silence the alarm and choose again"],
  ["Alien admissions issues a correction", "A lost shuttle mistakes you for an exchange student, checks the paperwork, and apologetically returns you to Earth. Somehow the clock now points to {previous_node}.", "Thank alien admissions and rewind"],
  ["The printer discovers Ctrl+Z", "The printer produces a sheet claiming that Ctrl+Z applies to life. One blue flash later, you are back at {previous_node}, while the printer denies taking time-travel electives.", "Press life's undo button"],
  ["A pigeon rejects this ending", "A stern campus pigeon steals the failure notice and folds the timeline into a paperclip. When the world stops spinning, you are standing at {previous_node}.", "Accept the pigeon's revision"],
];

function isFailure(id, page, ending) {
  if (ending && page.logic_page_role === "failure") return true;
  return /failure|failed|critical|collapse|rejected|expelled|退学|拒签|失败/i.test(id);
}

function recoveryIndexFor(id, fallbackIndex) {
  if (/R_B03_failed_exam/i.test(id)) return 0;
  if (/R_B03_O3/i.test(id)) return 8;
  if (/R_N10/i.test(id)) return 10;
  if (/R_B08/i.test(id)) return 12;
  if (/money/i.test(id)) return 5;
  if (/time/i.test(id)) return 4;
  if (/visa/i.test(id)) return 6;
  if (/housing/i.test(id)) return 7;
  if (/school/i.test(id)) return 2;
  if (/wellbeing|health|mood/i.test(id)) return 11;
  if (/local_language|language/i.test(id)) return 9;
  if (/career/i.test(id)) return 13;
  if (/academic_network|network/i.test(id)) return 3;
  return fallbackIndex;
}

for (const inputPath of storyPaths) {
  const resolved = path.resolve(inputPath);
  const story = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const pages = [
    ...Object.entries(story.nodes ?? {}).map(([id, page]) => ({ id, page, ending: false })),
    ...Object.entries(story.endings ?? {}).map(([id, page]) => ({ id, page, ending: true })),
  ].filter(({ id, page, ending }) => isFailure(id, page, ending));
  const chinese = pages.some(({ page }) => /[\u3400-\u9fff]/.test(page.scene_text ?? ""));
  const recoveries = chinese ? chineseRecoveries : englishRecoveries;
  const templateTitles = new Set([
    ...[...chineseRecoveries, ...englishRecoveries].map(([title]) => title),
    "行政窗口藏着秘密传送带",
  ]);

  for (const [id, page] of [...Object.entries(story.nodes ?? {}), ...Object.entries(story.endings ?? {})]) {
    const ending = Boolean(story.endings?.[id]);
    if (!isFailure(id, page, ending) && templateTitles.has(page.failure_recovery?.title)) delete page.failure_recovery;
  }

  pages.forEach(({ page }, index) => {
    if (page.failure_recovery?.scene_text?.includes("{previous_node}") && !templateTitles.has(page.failure_recovery?.title)) return;
    const [title, scene_text, return_choice_text] = recoveries[recoveryIndexFor(pages[index].id, index) % recoveries.length];
    page.failure_recovery = { title, scene_text, return_choice_text };
  });

  fs.writeFileSync(resolved, `${JSON.stringify(story, null, 2)}\n`, "utf8");
  process.stdout.write(`Backfilled ${pages.length} failure recoveries in ${resolved}\n`);
}
