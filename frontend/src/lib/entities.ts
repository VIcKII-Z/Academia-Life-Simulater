const names: Record<string, string> = Object.fromEntries(`
Japan|日本
Canada|加拿大
United States|美国
United States of America|美国
United Kingdom|英国
Australia|澳大利亚
Singapore|新加坡
Germany|德国
Switzerland|瑞士
Tokyo|东京
Kyoto|京都
Osaka|大阪
Sendai|仙台
Sapporo|札幌
Nagoya|名古屋
Fukuoka|福冈
Beppu|别府
Toronto|多伦多
Waterloo|滑铁卢
Montreal|蒙特利尔
Vancouver|温哥华
Edmonton|埃德蒙顿
Ottawa|渥太华
Kingston|金斯顿
Calgary|卡尔加里
New York|纽约
Ithaca|伊萨卡
Cambridge|剑桥
Boston|波士顿
Stanford|斯坦福
Berkeley|伯克利
Los Angeles|洛杉矶
Pittsburgh|匹兹堡
Ann Arbor|安娜堡
Urbana-Champaign|厄巴纳－香槟
Atlanta|亚特兰大
Seattle|西雅图
Oxford|牛津
London|伦敦
Edinburgh|爱丁堡
Manchester|曼彻斯特
Bristol|布里斯托尔
Coventry|考文垂
Glasgow|格拉斯哥
Leeds|利兹
Melbourne|墨尔本
Sydney|悉尼
Brisbane|布里斯班
Canberra|堪培拉
Perth|珀斯
Adelaide|阿德莱德
Munich|慕尼黑
Zurich|苏黎世
University of Tokyo|东京大学
The University of Tokyo|东京大学
Waseda University|早稻田大学
Keio University|庆应义塾大学
Tokyo Institute of Technology|东京工业大学
Sophia University|上智大学
Kyoto University|京都大学
Osaka University|大阪大学
Tohoku University|东北大学
Hokkaido University|北海道大学
Nagoya University|名古屋大学
Kyushu University|九州大学
Ritsumeikan Asia Pacific University|立命馆亚洲太平洋大学
University of Toronto|多伦多大学
University of Waterloo|滑铁卢大学
York University|约克大学
Toronto Metropolitan University|多伦多都会大学
McGill University|麦吉尔大学
Concordia University|康考迪亚大学
University of British Columbia|不列颠哥伦比亚大学
Simon Fraser University|西蒙菲莎大学
University of Alberta|阿尔伯塔大学
University of Ottawa|渥太华大学
Queen's University|女王大学
University of Calgary|卡尔加里大学
Columbia University|哥伦比亚大学
New York University|纽约大学
Cornell University|康奈尔大学
Cornell Tech|康奈尔科技学院
Massachusetts Institute of Technology|麻省理工学院
Harvard University|哈佛大学
Boston University|波士顿大学
Northeastern University|东北大学
Stanford University|斯坦福大学
UC Berkeley|加利福尼亚大学伯克利分校
University of Southern California|南加利福尼亚大学
UCLA|加利福尼亚大学洛杉矶分校
Carnegie Mellon University|卡内基梅隆大学
University of Michigan|密歇根大学
University of Illinois Urbana-Champaign|伊利诺伊大学厄巴纳－香槟分校
Georgia Institute of Technology|佐治亚理工学院
University of Washington|华盛顿大学
University of Oxford|牛津大学
University of Cambridge|剑桥大学
Imperial College London|伦敦帝国理工学院
University College London|伦敦大学学院
King's College London|伦敦国王学院
London School of Economics|伦敦政治经济学院
University of Edinburgh|爱丁堡大学
University of Manchester|曼彻斯特大学
University of Bristol|布里斯托尔大学
University of Warwick|华威大学
University of Glasgow|格拉斯哥大学
University of Leeds|利兹大学
University of Melbourne|墨尔本大学
Monash University|莫纳什大学
RMIT University|皇家墨尔本理工大学
University of Sydney|悉尼大学
UNSW Sydney|新南威尔士大学
University of Technology Sydney|悉尼科技大学
University of Queensland|昆士兰大学
Australian National University|澳大利亚国立大学
University of Western Australia|西澳大利亚大学
University of Adelaide|阿德莱德大学
National University of Singapore|新加坡国立大学
Nanyang Technological University|南洋理工大学
Singapore Management University|新加坡管理大学
Singapore University of Technology and Design|新加坡科技设计大学
Technische Universität München|慕尼黑工业大学
ETH Zurich|苏黎世联邦理工学院
Electrical Engineering|电气工程
Computer Science|计算机科学
Master of Science in Electrical Engineering|电气工程理学硕士
Master of Science (M.Sc.)|理学硕士
Master of Science in Electrical Engineering and Information Technology|电气工程与信息技术理学硕士
Electrical Engineering and Information Technology|电气工程与信息技术
TUM School of Computation, Information and Technology|慕尼黑工业大学计算、信息与技术学院
Undergraduate|本科
Taught Master|授课型硕士
Graduate|研究生
PhD|博士
Exchange Student|交换生
Master of Science in Electrical Engineering and Information Technology|电气工程与信息技术理学硕士
Electrical Engineering and Information Technology|电气工程与信息技术
TUM School of Computation, Information and Technology|慕尼黑工业大学计算、信息与技术学院
Undergraduate|本科
Taught Master|授课型硕士
Graduate|研究生
PhD|博士
Exchange Student|交换生
Department of Electrical and Computer Engineering|电气与计算机工程系
`.trim().split('\n').map((row) => row.split('|')));

let countryNames: Map<string, string> | undefined;
function countries(): Map<string, string> {
  if (countryNames) return countryNames;
  countryNames = new Map();
  const en = new Intl.DisplayNames(['en'], { type: 'region' });
  const zh = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = en.of(code);
    const translated = zh.of(code);
    if (name && translated && name !== code) countryNames.set(name, translated);
  }
  return countryNames;
}

/** Keep canonical values for API searches. Only localize their display labels. */
export function localizeEntity(value: string, language: string): string {
  if (language !== 'zh') return Object.entries(names).find(([, zh]) => zh === value)?.[0] ?? value;
  return names[value] ?? countries().get(value) ?? value;
}
