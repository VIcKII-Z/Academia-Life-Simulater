# Search Agent 搜索策略设计

本文档设计下一版 Search Agent 的搜索策略。目标是让 Agent 不只搜索"城市 + 专业 + 留学生活"的泛泛信息，而是尽量 case by case 地定位到具体学校、department、program，并从官方页面和学生经验中提取对真实入读该项目有用的资料。

> **本次修订说明**：原始草稿的分层搜索策略、fallback 逻辑、置信度分级和输出 schema 设计已经相当完整、可直接指导实现。本次修订主要补齐三处欠缺：(1) 新增"第零层"——政府/监管机构维护的官方结构化数据源（College Scorecard、Discover Uni、CRICOS、JASSO 等），这些是比学校官网更权威的"真北"来源，原稿完全没有涉及；(2) 新增"实现现状与可行性差距"一节，对照当前代码（`searchAgent.ts` 单次 `web_search_preview` 调用、`UserProfile` 缺少 school/department/program 字段）说明要落地本策略实际还差什么，避免文档和代码脱节；(3) 提供完整英文版 `search_agent_strategy.en.md`。
>
> **第二次修订说明（可访问性实测）**：Phase 0/1 上线后，我们直接测试了这些"第零层"网址对纯网页抓取（也就是只有 `web_search_preview`、无法调用需要密钥的 JSON API 的 agent 实际能拿到什么）。结果：大约一半是纯前端渲染的搜索类网站，直接抓取只会拿到空壳/Cookie 提示/搜索框——**College Scorecard 官网**（真实数据只存在于需要 `api.data.gov` 密钥的 API 里，网页本身抓不到）、**CRICOS Course Search**、**Discover Uni**、**QILT**、**JASSO** 的数据工具页在实测中均失败；**UK Register of Student Sponsors** 的真实名单在一个可下载的表格附件里，不在页面文本中。实测确认可靠的是：**IPEDS/College Navigator 的院校详情页**（实测 Cornell 页面能拿到真实的续读率/毕业率数据）、**gov.uk**、**canada.ca** 政策页（纯静态）、**NCES Fast Facts**，以及 **Wikipedia**（对院校事实/历史/认证类信息可靠，但绝不能作为学费/截止日期/签证细节这类需要时效性的硬事实来源）。`searchAgent.ts` 的 prompt 已相应调整：第一层（学校/项目官网本身）现在是默认起点，因为它是最能被稳定抓到的来源；"第零层"注册库只作为机会性补充，一旦返回空壳内容就应立刻回退到学校官网 + Wikipedia，而不是反复重试。详见英文版对应小节的完整表格。

## 目标

Search Agent 最终应帮助用户提前了解：

- 这个学校的这个项目到底学什么；
- department 和 program 的真实要求是什么；
- 国际学生需要准备什么；
- 项目所在城市的生活成本和生活方式；
- 该专业、该年级、该城市会带来什么具体压力；
- 这些压力如何映射到游戏中的 `health / mood / money`；
- 哪些资料来自官方，哪些来自学生经验，可信度如何。

用户输入最好逐步从粗到细：

```json
{
  "country": "United States",
  "city": "New York",
  "school": "New York University",
  "department": "Computer Science",
  "program": "MS in Computer Science",
  "major": "Computer Science",
  "grade": "Master"
}
```

如果用户没有输入学校、department、program，Search Agent 应该先按城市、专业、年级搜索通用信息，并提示“program-specific 信息不足”。

## 总体搜索原则

Search Agent 应按优先级搜索，而不是所有来源一视同仁。

优先级从高到低：

0. **官方结构化数据源 / 监管注册库**（政府、教育部、签证监管机构维护的结构化数据 —— 见"第零层"）
1. Program 官方页面
2. Department 官方页面
3. University catalog / graduate bulletin
4. Program handbook / department handbook
5. International student office / visa / work authorization 页面
6. Tuition / financial aid / cost of attendance 页面
7. Housing / campus life / student support 官方页面
8. Career services / internship / CPT / OPT 官方页面
9. 学生论坛、Reddit、GradCafe、Medium、个人 FAQ、学校 subreddit
10. 第三方留学数据库、排名网站、聚合网站
11. 城市生活成本网站和公开统计

第零层是本版新增的最高优先级层：它们不是"学校说了什么"，而是"监管机构 / 政府统计口径确认了什么"，因此比学校官网更权威，尤其适合验证签证资格、真实学费、以及项目是否被官方认证为可招收国际学生。官方来源（第0-8层）用于确认事实；论坛和学生经验（第9层）用于补充体感、风险、细节和隐性成本；第三方数据库（第10层）仅作交叉参考。

## 第零层：官方结构化数据源（"真北 / Ground-Truth"来源）

这一层是本版策略相对上一版最重要的补充：不再只依赖 LLM 的自由文本网页搜索，而是优先查询政府/监管机构维护的**结构化、可验证**数据源。这些来源通常有稳定 API 或可下载的开放数据集，返回结构化字段（而不是一段需要再摘要的文字），非常适合直接映射到 `program_profile` / `report` 字段，并且可信度天然高于任何学校自己的营销页面。

按国家/地区列出目前已知可用、且免费或近乎免费的权威来源：

### 美国

| 来源 | 用途 | 访问方式 |
| --- | --- | --- |
| **College Scorecard API**（U.S. Department of Education, `api.data.gov`） | 官方按 CIP 专业代码 + 学校维度的学费、平均债务、毕业后收入、录取率数据 | 免费 API key，REST，有官方文档 |
| **IPEDS / College Navigator**（NCES） | 官方院校层面统计：学费明细、住宿、师生比、毕业率、留存率 | 公开数据集 + College Navigator 网页，可批量下载 |
| **Study in the States / SEVP School Search**（ICE, DHS） | 验证学校是否为 SEVP 认证学校，可招收 F-1 国际学生 | 官方学校搜索页面，可核实资质而非编造 |
| **Federal Student Aid（FAFSA）School Code Search** | 验证学校联邦认证代码，交叉核实学校真实性 | 官方查询页面 |

### 英国

| 来源 | 用途 | 访问方式 |
| --- | --- | --- |
| **Discover Uni**（官方，数据来自 HESA + Office for Students） | 按 course 维度的官方学费、教学方式、就业率、毕业生薪资数据 | 网站 + 开放数据下载（Unistats 数据集） |
| **UK Register of Student Sponsors**（UKVI / Home Office） | 验证学校是否有资格担保 Student visa（Tier 4 继任者） | 官方注册名单，可直接核实签证资格 |

### 加拿大

| 来源 | 用途 | 访问方式 |
| --- | --- | --- |
| **Designated Learning Institutions (DLI) List**（IRCC） | 官方名单：哪些学校可招收持学签的国际学生 | 官方可下载列表 |
| **EduCanada / Universities Canada** | 官方项目和院校目录，可交叉核实项目名称是否真实存在 | 官方网站 |

### 澳大利亚

| 来源 | 用途 | 访问方式 |
| --- | --- | --- |
| **CRICOS Course Search**（澳大利亚政府） | 每个可招收国际学生的 course 都有官方登记：学费预估、时长、校区、签证资格 | 官方检索系统，逐 course 结构化数据 |
| **QILT – Compare Courses**（政府资助的教学质量指标） | 官方就业率、起薪、学生满意度，按 course 维度 | 官方网站，公开数据 |

### 日本

| 来源 | 用途 | 访问方式 |
| --- | --- | --- |
| **JASSO（日本学生支援机构）** | 官方国际学生统计、奖学金数据库、生活费用指南 | 官方网站，多语言 |
| **文部科学省（MEXT）留学信息** | 官方奖学金、签证、语言学校认证信息 | 官方网站 |

### 跨国参考（仅作交叉验证，非权威第一手数据）

- **QS / THE 排名 API**：商业数据源，免费层级有限，只适合作补充参考，不适合确认硬事实。
- **UNESCO / OECD 教育统计**：适合国家层面的宏观数据（如平均学费区间），不适合项目层面细节。

### 使用规则

1. 只要 profile 中的国家能匹配到上表中的来源，Search Agent 应在 Layer 1（program 官方页面）搜索**之前或同时**查询这些结构化来源。
2. 这些来源返回的字段（学费、签证资格、毕业率、起薪等）标记为 `source_type: "official_registry"`，置信度高于 `program_official`（因为它不依赖学校自己的表述，而是监管口径）。
3. 如果结构化来源和学校官网冲突（例如学校官网写的学费和 College Scorecard 不一致），应在 `gaps` 中注明冲突，而不是自行选择一个。
4. 不是所有国家/地区都有对应的结构化来源；没有覆盖时，直接进入 Layer 1，并在 `source_coverage.official_registry` 标记为 `false`。
5. 这一层目前多数需要额外的 API 集成或数据抓取，**不是**现有 `web_search_preview` 单次调用能直接做到的 —— 具体差距见文末"实现现状与可行性差距"一节。

## 第一层：Program 官方页面

这是最重要的来源。

Search Agent 应优先搜索：

```text
{school} {program} official
{school} {department} {program} curriculum
{school} {program} degree requirements
{school} {program} admissions international students
{school} {program} tuition
```

需要提取：

- 项目正式名称；
- 所属 school / department；
- degree 类型，例如 MS、MEng、MSc、PhD、BA、BS；
- 是否 full-time / part-time / residential / online；
- 是否适合国际学生签证；
- 项目长度；
- 学分要求；
- 核心课程；
- concentration / track；
- capstone / thesis / research project；
- internship / co-op 是否必需；
- 申请要求；
- 申请 deadline；
- 语言成绩要求；
- prerequisite；
- 项目联系人；
- 是否有 FAQ。

这些信息主要影响：

- `academic`
- `career`
- `visa`
- `money`
- 故事里的课程、项目、实验室、实习、毕业压力。

### 示例

像 Johns Hopkins 的 MSE Computer Science 官方页面会给出项目时长、课程要求、tuition、deadline、research project 等信息。类似信息应被优先采集，因为它直接决定玩家在该项目中的学业路径。

## 第二层：Department 官方页面

如果 program 页面信息不足，或者用户输入的是 department 而非具体 program，应搜索 department 页面。

搜索 query：

```text
{school} {department} graduate programs
{school} {department} faculty research areas
{school} {department} graduate student handbook
{school} {department} advising graduate students
{school} {department} assistantship funding
```

需要提取：

- department 的研究方向；
- faculty / lab / research group；
- advising 方式；
- graduate community；
- TA / RA / assistantship；
- PhD vs Master 差异；
- lab culture 或 research expectation；
- department 内的项目列表；
- department handbook。

这些信息尤其重要于 PhD 和 research master。

### 对游戏的作用

如果用户选择 PhD，Design Agent 应优先使用 department 信息生成：

- 导师沟通；
- 组会；
- lab deadline；
- funding；
- publication；
- qualifying exam；
- thesis proposal；
- conference travel；
- TA 任务。

如果用户选择 undergraduate，则 department 信息更多用于课程结构、major requirement、project、career track。

## 第三层：University Catalog / Graduate Bulletin

Catalog 通常比 marketing 页面更正式，也更结构化。

搜索 query：

```text
{school} catalog {program}
{school} graduate bulletin {program}
{school} academic catalog {department} {program}
{school} degree requirements {program} catalog
```

需要提取：

- 官方 degree requirements；
- 学分；
- required courses；
- elective rules；
- GPA requirement；
- residency requirement；
- academic standing；
- transfer credit；
- internship / thesis / capstone 规定。

Catalog 可以作为 program 页面不完整时的事实校验来源。

## 第四层：Program / Department Handbook

Handbook 是非常关键的资料源。它经常包含 program 页面不会写的真实约束。

搜索 query：

```text
{school} {department} graduate handbook pdf
{school} {program} student handbook
{school} {department} PhD handbook
{school} {department} MS handbook
```

需要提取：

- degree progress timeline；
- advisor assignment；
- milestones；
- qualifying exam；
- thesis / dissertation；
- TA / RA 规则；
- funding policy；
- full-time enrollment；
- leave / probation；
- international student notes；
- internship / CPT 注意事项；
- workload 和选课建议。

### 资料例子

调研中发现多个 CS department 都有 handbook，例如 Rice、CMU、Penn State、Indiana University、University of Kentucky 等。这类 handbook 往往比招生页更适合用来构建真实挑战。

### 对游戏的作用

Handbook 信息可以转化为：

- 学术节点；
- advisor 节点；
- funding 节点；
- TA 任务节点；
- visa / CPT 节点；
- 进度危机节点。

## 第五层：International Student Office

这是签证、工作、CPT、OPT、身份维护的权威来源。

搜索 query：

```text
{school} international student office CPT OPT
{school} international students visa requirements
{school} F-1 CPT OPT international office
{school} immigration full-time enrollment international students
{country} student visa work hours official
```

需要提取：

- 学生签证类型；
- full-time enrollment 要求；
- CPT / OPT / internship 规则；
- 校内打工；
- 校外打工；
- work hour limit；
- I-20 / CoE / CAS 等文件；
- 资金证明；
- health insurance；
- 维持身份的注意事项。

如果是美国项目，应优先查学校 international office，其次查 Study in the States、ICE、USCIS 等官方来源。

如果是英国、加拿大、澳洲、日本等，应优先查学校 international office 和对应国家政府/移民局官网。

### 对游戏的作用

这些资料可以生成：

- 签证材料 deadline；
- 工作时长取舍；
- internship authorization；
- 身份维护压力；
- money 与 academic 的冲突。

## 第六层：Tuition / Cost of Attendance / Financial Aid

费用是 `money` 数值最重要来源。

搜索 query：

```text
{school} {program} tuition international students
{school} cost of attendance international graduate
{school} tuition fees {program}
{school} financial documentation international students
{school} graduate funding {department}
```

需要提取：

- tuition；
- fees；
- health insurance；
- estimated living expenses；
- proof of funds；
- payment deadline；
- scholarship；
- assistantship；
- tuition waiver；
- master 是否有 funding；
- PhD 是否 guaranteed funding；
- hidden costs，如 books、equipment、transportation、student fees。

### 优先级

1. 学校官方 tuition 页面；
2. international office 的 estimated expenses；
3. program 页面中的 tuition；
4. department funding 页面；
5. 第三方数据库作为补充或交叉验证。

## 第七层：Housing / Campus Life / Student Support

这些来源用于构建生活细节。

搜索 query：

```text
{school} graduate housing
{school} off campus housing international students
{school} student life graduate students
{school} counseling international students
{school} student clubs international students
{city} student housing {school}
```

需要提取：

- on-campus housing 是否可用；
- off-campus housing 区域；
- 通勤方式；
- 房租范围；
- 合租；
- 安全；
- counseling；
- student clubs；
- international community；
- graduate student association；
- food / meal plan。

这些信息影响：

- `health`
- `mood`
- `money`

## 第八层：Career Services / Internship / Industry Links

职业信息要尽量贴近 program 和 city。

搜索 query：

```text
{school} {program} career outcomes
{school} {department} internship
{school} career services international students CPT
{school} {program} employment report
{city} {major} internship opportunities international students
```

需要提取：

- internship 是否常见；
- co-op 是否内置；
- career fair；
- employment report；
- local industry；
- alumni outcomes；
- employer connections；
- international student work authorization限制；
- 该专业在城市中的就业机会。

例如：

- CS + Silicon Valley：实习机会多，但竞争、房租、面试压力高。
- Business + New York：networking 和实习机会多，但社交成本、职业装、交通、心理压力高。
- PhD + Tokyo：industry internship 可能和导师、研究进度、日语能力相关。

## 第九层：论坛和学生经验

论坛不能作为事实来源的第一优先级，但它们非常适合补充“真实体验”。

可用来源：

- Reddit 学校 subreddit；
- Reddit `r/gradadmissions`；
- Reddit `r/csMajors`；
- The GradCafe；
- Medium 学生经验；
- 个人 FAQ / blog；
- Facebook / Discord / 微信群信息，如果可以访问；
- 学生 housing guide；
- 论坛里的课程难度、项目节奏、housing、TA、就业讨论。

搜索 query：

```text
site:reddit.com {school} {program} workload
site:reddit.com {school} {program} international students
site:reddit.com {school} {program} housing
site:reddit.com {school} {program} internship
site:reddit.com/r/gradadmissions {school} {program}
site:thegradcafe.com {school} {program}
{school} {program} student experience blog
{school} {program} FAQ international students
```

需要提取：

- workload 体感；
- 哪些课程被认为很难；
- first semester 是否容易 overload；
- housing 难点；
- commute；
- TA/RA 是否现实；
- 实习和求职压力；
- 国际学生遇到的隐性问题；
- 社交、孤独、城市适应；
- “官方没写但学生经常提到”的问题。

### 可信度处理

论坛信息必须打标签：

```json
{
  "claim": "Students often warn against taking more than 18 credits in the first semester.",
  "source_type": "student_forum",
  "confidence": "medium",
  "needs_official_confirmation": true
}
```

论坛不应直接用于确定 tuition、签证规则、deadline 等硬事实；这些必须由官方来源确认。

## 第十层：第三方留学数据库和排名网站

这类网站可以作为补充，不应作为最高优先级。

可用来源：

- Yocket；
- GradPilot；
- QS / US News / THE；
- MastersPortal；
- FindAMasters；
- Peterson's；
- 其他留学中介或数据库。

适合提取：

- program 名称；
- 大致学费；
- deadline；
- ranking；
- 申请材料；
- 项目概况；
- 可能的第三方评价。

不适合单独确认：

- 最新 tuition；
- 签证规则；
- official deadline；
- funding policy；
- program 是否支持 F-1 / student visa；
- 课程要求。

## Fallback 搜索策略

Search Agent 应按“逐级降级”的方式工作。

### 情况 1：能找到 program 官方页面

使用：

1. Program 页面；
2. Catalog；
3. Handbook；
4. International office；
5. Tuition / cost；
6. Housing / career；
7. Forum 补充。

这是最理想情况。

### 情况 2：找不到具体 program 页面，但能找到 department 页面

使用：

1. Department graduate programs；
2. Catalog 中对应 degree；
3. Department handbook；
4. Faculty / research group；
5. International office；
6. Tuition；
7. Forum。

输出中要标注：

```text
Program-specific official page not found. Used department-level sources instead.
```

### 情况 3：找不到 department 页面，但能找到学校和专业方向

使用：

1. University catalog；
2. Graduate school program list；
3. Admissions page；
4. Tuition / cost；
5. International office；
6. City + major industry info；
7. Forum / student posts。

输出中要标注资料粒度较粗。

### 情况 4：学校信息很少

使用：

1. 国家/城市/专业通用信息；
2. 相似学校或相似 program；
3. 官方移民局；
4. 城市生活成本；
5. 行业就业信息；
6. 论坛。

输出中必须明确：

```text
No reliable official program-level source found. The report uses city/major-level fallback information.
```

### 情况 5：论坛信息缺失

如果论坛或学生经验找不到，不应编造。

可以替代：

- program handbook；
- course catalog；
- student life office；
- housing office；
- career services；
- international office FAQ；
- alumni outcome page；
- LinkedIn alumni profiles，如果可访问；
- YouTube / blog / Medium 学生经验，如果可用。

## 推荐的搜索流程

### Step 1：解析用户输入

将用户输入拆成：

```json
{
  "country": "string",
  "city": "string",
  "school": "string | optional",
  "department": "string | optional",
  "program": "string | optional",
  "major": "string",
  "grade": "Undergraduate | Master | PhD | Exchange | High School"
}
```

如果缺少 `school / department / program`，Search Agent 应尽量从用户补充或搜索推断，但不要假装确定。

### Step 2：先找 program official source

优先 query：

```text
{school} {program} official
{school} {department} {program}
{school} {program} curriculum
{school} {program} admissions
```

判断是否命中：

- 页面 URL 属于学校官方 domain；
- 页面标题包含 program 名称；
- 页面内容包含 degree、curriculum、admissions、tuition 或 FAQ；
- 页面不是第三方排名/中介页面。

### Step 3：补 catalog 和 handbook

query：

```text
{school} {program} catalog
{school} {department} graduate handbook pdf
{school} {program} handbook
```

这一步用于确认课程、学分、milestone、funding、academic standing。

### Step 4：查国际学生与签证

query：

```text
{school} international students visa {program}
{school} international office CPT OPT
{country} student visa work hours official
```

如果是美国：

- school international office；
- Study in the States；
- ICE；
- USCIS；
- school CPT / OPT 页面。

如果是英国、加拿大、澳洲、日本：

- school international office；
- 对应国家移民局；
- 学校 visa guide。

### Step 5：查费用与 funding

query：

```text
{school} {program} tuition
{school} cost of attendance international students
{school} graduate funding {department}
{school} assistantship {program}
```

需要区分：

- tuition；
- living cost；
- mandatory fee；
- health insurance；
- proof of funds；
- scholarship；
- TA/RA；
- master 和 PhD funding 差异。

### Step 6：查 housing /生活 /城市

query：

```text
{school} graduate housing
{school} off campus housing
{city} student housing {school}
{city} cost of living international students
{school} student life international students
```

需要得到：

- 住宿是否紧张；
- 住哪里；
- commute；
- 安全；
- 生活成本；
- campus support；
- 社群。

### Step 7：查 career / internship

query：

```text
{school} {program} career outcomes
{school} {department} internship
{school} career services international students
{city} {major} internship jobs international students
```

需要得到：

- program 是否有 internship；
- career fair；
- local industry；
- international student work limits；
- 是否需要当地语言；
- major 在该城市的机会。

### Step 8：查论坛和学生经验

query：

```text
site:reddit.com {school} {program} workload
site:reddit.com {school} {program} housing
site:reddit.com {school} {program} international students
site:thegradcafe.com {school} {program}
{school} {program} student experience blog
{school} {program} FAQ international students
```

论坛信息只用于：

- workload 体感；
- housing 难点；
- 课程选择建议；
- 社交/孤独；
- program value；
- career pressure；
- 隐性成本。

## 输出结构建议

下一版 Search Agent 可以输出更细的结构，而不是只输出 9 个字段。

```json
{
  "mode": "live_search",
  "profile": {
    "country": "United States",
    "city": "New York",
    "school": "New York University",
    "department": "Computer Science",
    "program": "MS in Computer Science",
    "major": "Computer Science",
    "grade": "Master"
  },
  "source_coverage": {
    "program_official": true,
    "department_official": true,
    "catalog": true,
    "handbook": false,
    "international_office": true,
    "tuition": true,
    "housing": true,
    "career": true,
    "student_forum": true
  },
  "program_profile": {
    "official_name": "string",
    "degree_type": "string",
    "department": "string",
    "duration": "string",
    "delivery_mode": "full-time / part-time / residential / online",
    "visa_eligible_notes": "string",
    "curriculum": ["string"],
    "milestones": ["string"],
    "prerequisites": ["string"],
    "admissions": ["string"],
    "deadlines": ["string"],
    "funding": ["string"]
  },
  "student_life_profile": {
    "housing": "string",
    "commute": "string",
    "campus_support": "string",
    "community": "string",
    "safety": "string",
    "climate": "string"
  },
  "career_profile": {
    "local_industry": "string",
    "internship": "string",
    "work_authorization": "string",
    "language_or_networking_requirements": "string"
  },
  "report": {
    "cost_of_living": "string",
    "academic": "string",
    "visa": "string",
    "culture_shock": "string",
    "community": "string",
    "career": "string",
    "safety": "string",
    "climate": "string",
    "part_time_work": "string"
  },
  "gameplay_signals": {
    "health": ["string"],
    "mood": ["string"],
    "money": ["string"],
    "city_major_grade_specific_challenges": ["string"]
  },
  "sources": [
    {
      "title": "string",
      "url": "string",
      "source_type": "program_official | department | catalog | handbook | international_office | tuition | housing | career | forum | third_party",
      "confidence": "high | medium | low",
      "used_for": ["academic", "money", "visa"]
    }
  ],
  "gaps": [
    "Could not find official program handbook.",
    "Student forum evidence is sparse."
  ]
}
```

## Source Confidence 规则

### Official registry confidence（新增，最高等级）

来源：

- College Scorecard、IPEDS（美国）；
- Discover Uni、UK Register of Student Sponsors（英国）；
- DLI List（加拿大）；
- CRICOS、QILT（澳大利亚）；
- JASSO、MEXT（日本）；
- 其他政府/监管机构维护的注册库或统计数据库。

可用于：

- 签证/招生资格的硬性验证（例如"这所学校是否能担保国际学生签证"）；
- 官方统计口径的学费、毕业率、起薪；
- 与学校官网冲突时的仲裁依据。

这一等级高于 High confidence，因为它不依赖学校自身表述，而是监管机构的独立数据。如果和 High confidence 来源冲突，应以此为准，并在 `gaps` 中记录冲突。

### High confidence

来源：

- program 官方页面；
- department 官方页面；
- catalog；
- handbook；
- international office；
- 学校 tuition / cost 页面；
- 政府移民局。

可用于：

- deadline；
- curriculum；
- tuition；
- visa；
- work authorization；
- degree requirement；
- official funding。

### Medium confidence

来源：

- 学生 blog；
- Medium；
- Reddit；
- GradCafe；
- 学校 subreddit；
- alumni FAQ；
- 第三方数据库。

可用于：

- workload；
- housing 难度；
- 课程体感；
- program value；
- 社交压力；
- 隐性成本。

### Low confidence

来源：

- SEO 留学文章；
- 未注明来源的中介页面；
- 过期帖子；
- 无法确认时间的信息。

只可作为参考，不能作为核心事实。

## 如何确保资料完善且可行

Search Agent 应满足以下最低标准。

### 最低可用标准

至少找到：

- 1 个 program 或 department 官方来源；
- 1 个 tuition / cost 来源；
- 1 个 international student / visa 来源；
- 1 个 city living / housing 来源；
- 1 个 career 或 internship 来源。

如果缺少 program 官方来源，必须在输出中标注。

### 理想标准

理想情况下找到：

- program official page；
- catalog；
- department handbook；
- international office；
- tuition/cost；
- housing/student life；
- career/internship；
- 2-3 个学生经验来源。

### 不允许的行为

Search Agent 不应该：

- 编造 program requirement；
- 编造 tuition；
- 编造签证政策；
- 把论坛当成官方事实；
- 用另一个学校的项目假装当前学校项目；
- 找不到 program 时不说明信息缺失；
- 只写城市泛泛信息，忽略学校和 program。

## 给 Design Agent 的信息重点

Design Agent 最需要以下信息：

1. 项目强度
   决定学业节点和 `health / mood` 压力。

2. Funding 和费用
   决定 `money` 压力。

3. 住房和通勤
   决定 `health / money` tradeoff。

4. 国际学生身份
   决定 visa / CPT / work authorization 节点。

5. 专业特有任务
   决定故事是否有专业差异。

6. 年级特有生活方式
   决定本科、硕士、博士体验差异。

7. 学生经验中的隐性风险
   决定故事是否真实。

## 示例：Search Agent 如何处理一个输入

输入：

```json
{
  "country": "United States",
  "city": "Ithaca",
  "school": "Cornell University",
  "department": "Computer Science",
  "program": "MEng in Computer Science",
  "grade": "Master"
}
```

搜索顺序：

1. `Cornell MEng Computer Science official`
2. `Cornell MEng Computer Science curriculum`
3. `Cornell MEng Computer Science FAQ`
4. `Cornell Computer Science MEng tuition`
5. `Cornell international students CPT OPT`
6. `Cornell graduate housing Ithaca`
7. `Cornell MEng Computer Science student experience`
8. `site:reddit.com Cornell MEng CS workload`
9. `Cornell MEng CS Medium student experience`

可能提取到：

- MEng 是职业导向硕士；
- 课程和 project 要求；
- first semester 不能 overload；
- Ithaca housing 要提前找；
- 冬天和通勤会影响生活；
- international office 处理签证和 work authorization；
- career preparation 很重要。

转给 Design Agent 的玩法信号：

- `money`: tuition、housing、professional/career cost；
- `health`: winter、course overload、commute；
- `mood`: new city isolation、project pressure、networking confidence；
- challenge: first-semester course load、housing search、career fair、project deadline。

## 实现现状与可行性差距

在推进 Phase 1-3 之前，需要明确当前代码与本策略之间的实际差距，避免规划和实现脱节。

### 现状（截至本次修订）

- `backend/src/agents/searchAgent.ts` 的 `runSearchAgentLive` 目前是**单次** `client.responses.create()` 调用，使用 `web_search_preview` 工具，一次性让模型自己决定搜什么、搜几次，然后直接产出最终 JSON。没有分层、分阶段的搜索计划，也没有 source list、confidence、gaps 字段。
- `UserProfile` 类型（`backend/src/types.ts`）目前只有 `country / city / major / grade` 四个字段，**没有 `school / department / program`**。前端 `QuizFlow.tsx` 的问题也只收集这四项。也就是说，本文档设想的 case-by-case（细到具体学校项目）目前在产品输入层就还没打通。
- 没有集成任何第零层的官方结构化数据源 API（College Scorecard、Discover Uni、CRICOS 等）——目前全部信息来自模型自带的 `web_search_preview`，其覆盖面和可靠性完全取决于模型自己抓到的网页。

### 要落地本文档，至少需要以下改动

1. **Schema 改动**：`UserProfile` 增加可选的 `school / department / program` 字段；`QuizFlow.tsx` 增加对应的可选输入步骤（允许留空并回退到城市+专业层级）；`buildCacheStoryId` 的 hash payload 也要包含这些新字段，否则不同学校/项目会错误命中同一个缓存。
2. **Layer 0 集成**：至少接入 College Scorecard（美国）作为第一个试点——它有免费 API key、REST 接口简单，最容易低成本验证"结构化官方数据能显著提升真实感"这个假设。其余地区的 Layer 0 源可以后续再加。
3. **多轮搜索执行器**：`web_search_preview` 工具允许模型在同一次 `responses.create` 调用中多次调用搜索（模型自主决定），但如果要严格按本文档的阶段顺序（program → catalog → visa → tuition → housing → career → forum）执行并分别记录每阶段的命中情况，需要**显式拆成多次 `responses.create` 调用**，用 `previous_response_id` 串联对话上下文，每次调用聚焦一个阶段并要求模型只返回该阶段的结构化结果，最后由代码合并成完整报告。这比现在的单次调用更慢、更贵，需要配合下面的搜索预算控制。
4. **搜索预算限制**：多轮搜索会显著增加延迟和 token/请求成本。建议给每次生成设置上限，例如"最多 6-8 轮搜索阶段，每阶段最多 1-2 次工具调用"，超出预算的阶段直接标记为 `gaps`，而不是无限重试。
5. **输出 schema 迁移**：`ResearchReport` 类型（`backend/src/types.ts`）需要从当前的 9 字段扁平结构，扩展为本文档"输出结构建议"里的嵌套结构（`source_coverage` / `program_profile` / `student_life_profile` / `career_profile` / `sources` / `gaps`），Design Agent 的 prompt 也需要相应更新以消费这些新字段。

### 建议的落地顺序

按投入产出比排序，不必等全部做完：

1. Schema 改动（低成本，解锁所有后续工作）；
2. Prompt 升级到本文档的分层结构，但仍是单次 `web_search_preview` 调用（中等成本，立刻提升真实感）；
3. 接入 College Scorecard 作为首个 Layer 0 源（中等成本，验证"官方结构化数据"价值）；
4. 多轮搜索执行器 + 搜索预算控制（高成本，仅在前几步验证有效后再做）。

## 后续实现建议

为了让 Search Agent 真正 case by case，可分四步升级（原三步基础上，前置一步 Schema/Layer 0 工作）。

### Phase 0：Schema 与 Layer 0 试点

- `UserProfile` 增加 `school / department / program`（均为可选）；
- 更新 `QuizFlow.tsx` 增加对应的可选输入；
- 更新 `buildCacheStoryId` 的 hash payload；
- 接入 College Scorecard API 作为第一个 Layer 0 源。

### Phase 1：Prompt 升级

在当前 Search Agent prompt 中加入：

- school / department / program 字段；
- source priority；
- source coverage；
- gaps；
- sources list；
- program_profile；
- student_life_profile；
- career_profile。

### Phase 2：多轮搜索计划

不要只做一次 broad web_search。让 Search Agent 分阶段搜索：

1. official program；
2. catalog/handbook；
3. international/visa；
4. tuition/housing；
5. career；
6. forums。

每一阶段都记录命中的来源和缺口。技术上需要拆成多次 `responses.create` 调用并用 `previous_response_id` 串联，见上文"实现现状与可行性差距"。

### Phase 3：可靠性评分

给每个结论附上：

- source_type（含新增的 `official_registry`）；
- confidence（含新增的 official registry 等级）；
- whether_official；
- used_for；
- needs_confirmation。

这样 Design Agent 可以优先使用高可信事实，并把论坛信息作为体验细节，而不是硬规则。

