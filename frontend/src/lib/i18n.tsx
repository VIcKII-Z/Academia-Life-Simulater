import { useEffect, createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { localizeEntity } from "./entities";
import { translateCopy } from "./uiCopy";

export type Language = "en" | "zh";

const LANGUAGE_STORAGE_KEY = "fls.language";

const LANGUAGE_LABELS: Record<Language, string> = {
  en: "EN",
  zh: "中文",
};

const DATE_LOCALES: Record<Language, string> = {
  en: "en-US",
  zh: "zh-CN",
};

const translations: Record<Language, Record<string, string>> = {
  en: {
    "common.cancel": "Cancel",
    "common.next": "Next",
    "common.skip": "Skip",
    "common.edit": "Edit",
    "common.loadingCountries": "Loading countries...",
    "top.travelKey": "Travel key",
    "top.imagesOn": "Images on",
    "top.imagesOff": "Images off",
    "cacheDemo.title": "Open recent generated stories",
    "cacheDemo.subtitle": "Open a completed story in your selected language without waiting for generation.",
    "language.label": "Language",
    "language.aria": "Choose language",
    "passport.title": "Enter your travel key",
    "passport.titleCompact": "Update your travel key",
    "passport.lede": "Your future life abroad is generated just for you. We need an API key to open your journal - it stays in this browser only and is never written to our logs.",
    "passport.ledeCompact": "Change or re-enter your API key anytime - it stays in this browser only and is never written to our logs.",
    "passport.providerAria": "Choose your provider",
    "passport.relay": "Relay",
    "passport.openai": "Official OpenAI",
    "passport.relayKeyError": "Enter your relay API key to unlock your travel journal.",
    "passport.openaiKeyError": "Enter your OpenAI API key to unlock your travel journal.",
    "passport.baseUrlError": "Enter your relay's base URL.",
    "passport.relayPlaceholder": "Relay API key...",
    "passport.openaiPlaceholder": "sk-... (OpenAI API key)",
    "passport.relayHint": "Using a relay endpoint - enter its base URL below. Change this and other settings anytime from the debug page.",
    "passport.openaiHint": "Using the official OpenAI API - no base URL needed. Note: some features, like Live Search, call the OpenAI Responses API directly and may not work through third-party relays.",
    "passport.baseUrlPlaceholder": "Relay base URL, e.g. https://your-relay.example/v1",
    "passport.saveKey": "Save key",
    "passport.openJournal": "Open my journal",
    "quiz.country.title": "Where in the world?",
    "quiz.country.subtitle": "Search countries and pick one from the list.",
    "quiz.country.placeholder": "Search countries...",
    "quiz.country.noMatch": "No matching country found.",
    "quiz.city.title": "Which city?",
    "quiz.city.subtitle": "Search cities in {country} and pick one from the list.",
    "quiz.city.placeholder": "Search cities... e.g. Santa Barbara",
    "quiz.city.loading": "Searching cities worldwide...",
    "quiz.city.noMatch": "No matching city found in {country}. Keep typing to search.",
    "quiz.university.title": "Which university?",
    "quiz.university.subtitle": "Search universities in {location} and pick one from the list.",
    "quiz.university.placeholder": "Search a university name...",
    "quiz.university.loading": "Searching universities worldwide...",
    "quiz.university.noMatch": "No matching university found. Keep typing to search.",
    "quiz.degree.title": "What stage of student would you be?",
    "quiz.degree.subtitle": "Just so we can picture the right chapter of your journey.",
    "quiz.customPlaceholder": "Or write your own...",
    "quiz.semesters.title": "How many semesters is your stay?",
    "quiz.semesters.labelOne": "semester",
    "quiz.semesters.labelMany": "semesters",
    "quiz.semesters.aria": "Number of semesters",
    "quiz.semesters.hintShort": "A short, focused stay - one or two chapters, tightly wound toward a single ending.",
    "quiz.semesters.hintMedium": "A full year or two abroad - enough time for real routines and relationships to form.",
    "quiz.semesters.hintLong": "A long-haul journey - your story branches further, with more room to specialize.",
    "quiz.semesters.hintSaga": "A multi-year saga - the longest, richest version of your story, with an ending shaped by years abroad.",
    "quiz.details.title": "Know the exact department or program?",
    "quiz.details.subtitle": "Optional - give us a specific department or program and we'll research that exact case instead of a generic school-level overview. Leave blank to skip.",
    "quiz.details.department": "Department",
    "quiz.details.departmentPlaceholder": "e.g. Graduate School of Information Science",
    "quiz.details.program": "Program",
    "quiz.details.programPlaceholder": "e.g. MS in Computer Science",
    "quiz.details.begin": "Begin my story",
    "quiz.done.country": "Country",
    "quiz.done.city": "City",
    "quiz.done.university": "University",
    "quiz.done.degree": "Level",
    "quiz.done.semesters": "Length of stay",
    "degree.Undergraduate": "Undergraduate",
    "degree.Taught Master": "Taught Master",
    "degree.Graduate": "Graduate",
    "degree.PhD": "PhD",
    "degree.Exchange Student": "Exchange Student",
    "admission.department": "Admissions & Life Simulator",
    "admission.fallbackUniversity": "a university in {city}",
    "admission.salutation": "Dear future {grade} student,",
    "admission.congrats": "Congratulations!",
    "admission.bodyStart": "We are delighted to inform you that the Admissions Committee has offered you a place at",
    "admission.toPursue": "to pursue",
    "admission.inDepartment": "in the",
    "admission.welcome": "Welcome to {university}!",
    "admission.tagline": "We can't wait to see you in {city}, {country}.",
    "admission.closing": "A transformative study-abroad experience awaits you - new routines, new people, and choices only you can make. Your journey begins the moment you turn the page.",
    "admission.accept": "Accept the offer",
    "admission.decline": "Decline the offer",
    "timeskip.line1": "A few months pass while you get ready to leave...",
    "timeskip.line2": "After a long summer, moving day finally arrives...",
    "timeskip.line3": "You settle into {city} and find your way around {school}...",
    "timeskip.line4": "Orientation week wraps up - your first semester is about to begin...",
    "timeskip.schoolFallback": "your new school in {city}",
    "timeskip.sub": "Your first scene is on its way.",
    "error.title": "Something went wrong",
    "error.tryAgain": "Try again",
    "story.reused": "Reusing a story we already generated for this exact profile - no need to regenerate.",
    "story.gameOver": "Your {stat} ran out.",
    "story.gameOverEnding": "{reason} Your study-abroad story ends here - sometimes life abroad doesn't go as planned.",
    "stats.health": "Health",
    "stats.group": "Life stats",
    "stats.mood": "Mood",
    "stats.money": "Money",
    "stats.school": "School",
    "scene.fieldNotes": "Field Notes",
    "scene.why": "Why this happens",
    "scene.emptyNotes": "Every scene in your story is generated from live research about student life in {caption}. Watch this space for notes on why each challenge tends to show up.",
    "scene.about": "About this story",
    "scene.sources": "Sources",
    "scene.choicePrompt": "what do you do?",
    "category.academics": "Academics",
    "category.career": "Career",
    "category.housing": "Housing",
    "category.social": "Social Life",
    "category.events": "Campus Events",
    "category.campus": "Campus Life",
    "ending.postmarked": "Postmarked from {city}",
    "ending.title": "Your story, sealed",
    "ending.fieldNote": "Field note",
    "ending.restart": "Start a new chapter",
    "ending.save": "Save this story",
    "tone.hopeful": "Hopeful",
    "tone.bittersweet": "Bittersweet",
    "tone.challenging": "Challenging",
    "keepsake.title": "FUTURE LIFE SIMULATOR - YOUR STORY, SEALED",
    "keepsake.postmarked": "Postmarked from {city}, {country}",
    "keepsake.tone": "Ending tone: {tone}",
    "keepsake.fieldNote": "FIELD NOTE - WHY THIS HAPPENS",
    "keepsake.about": "ABOUT THIS STORY",
    "keepsake.stats": "FINAL STATS",
    "keepsake.sources": "SOURCES",
  },
  zh: {
    "common.cancel": "取消",
    "common.next": "下一步",
    "common.skip": "跳过",
    "common.edit": "编辑",
    "common.loadingCountries": "正在加载国家...",
    "top.travelKey": "旅行钥匙",
    "top.imagesOn": "图片开启",
    "top.imagesOff": "图片关闭",
    "cacheDemo.title": "最近的留学故事",
    "cacheDemo.subtitle": "直接打开当前语言的已完成故事，无需等待生成。",
    "language.label": "语言",
    "language.aria": "选择语言",
    "passport.title": "输入你的旅行钥匙",
    "passport.titleCompact": "更新旅行钥匙",
    "passport.lede": "你的未来留学生活会为你专属生成。我们需要 接口密钥 来打开日记；它只保存在这个浏览器里，不会写入日志。",
    "passport.ledeCompact": "你可以随时修改或重新输入 接口密钥；它只保存在这个浏览器里，不会写入日志。",
    "passport.providerAria": "选择服务提供方",
    "passport.relay": "中转站",
    "passport.openai": "OpenAI 官方",
    "passport.relayKeyError": "请输入中转站 接口密钥 来开启你的旅行日记。",
    "passport.openaiKeyError": "请输入 OpenAI 接口密钥 来开启你的旅行日记。",
    "passport.baseUrlError": "请输入中转站的 服务地址。",
    "passport.relayPlaceholder": "中转站 接口密钥...",
    "passport.openaiPlaceholder": "sk-...（OpenAI 接口密钥）",
    "passport.relayHint": "你正在使用中转站，请在下方输入它的 服务地址。也可以之后在 调试页面修改这些设置。",
    "passport.openaiHint": "你正在使用 OpenAI 官方 API，不需要 服务地址。注意：实时搜索等功能会直接调用官方响应接口，部分第三方中转可能不支持。",
    "passport.baseUrlPlaceholder": "中转站 服务地址，例如 https://your-relay.example/v1",
    "passport.saveKey": "保存钥匙",
    "passport.openJournal": "打开我的日记",
    "quiz.country.title": "你想去世界的哪里？",
    "quiz.country.subtitle": "搜索国家，并从列表里选择一个。",
    "quiz.country.placeholder": "搜索国家...",
    "quiz.country.noMatch": "没有找到匹配的国家。",
    "quiz.city.title": "哪座城市？",
    "quiz.city.subtitle": "在 {country} 搜索城市，并从列表里选择一个。",
    "quiz.city.placeholder": "搜索城市...例如 圣巴巴拉",
    "quiz.city.loading": "正在全球搜索城市...",
    "quiz.city.noMatch": "没有在 {country} 找到匹配城市。继续输入试试。",
    "quiz.university.title": "哪所大学？",
    "quiz.university.subtitle": "在 {location} 搜索大学，并从列表里选择一个。",
    "quiz.university.placeholder": "搜索大学名称...",
    "quiz.university.loading": "正在全球搜索大学...",
    "quiz.university.noMatch": "没有找到匹配大学。继续输入试试。",
    "quiz.degree.title": "你会处于哪个学习阶段？",
    "quiz.degree.subtitle": "这样我们能想象出更贴近你的故事章节。",
    "quiz.customPlaceholder": "或写下你自己的答案...",
    "quiz.semesters.title": "你的留学会持续几个学期？",
    "quiz.semesters.labelOne": "个学期",
    "quiz.semesters.labelMany": "个学期",
    "quiz.semesters.aria": "学期数量",
    "quiz.semesters.hintShort": "一段短而集中的旅程：一两个章节，快速走向一个清晰结局。",
    "quiz.semesters.hintMedium": "一到两年的海外生活：足够形成真实的日常和关系。",
    "quiz.semesters.hintLong": "一段更长期的旅程：有更多空间发展专业方向与生活变化。",
    "quiz.semesters.hintSaga": "多年篇章：最丰富的版本，结局会被多年海外生活塑造。",
    "quiz.details.title": "知道具体院系或项目吗？",
    "quiz.details.subtitle": "可选：提供具体院系或项目后，我们会研究这个精确案例，而不是泛泛的学校概况。留空即可跳过。",
    "quiz.details.department": "院系",
    "quiz.details.departmentPlaceholder": "例如 信息科学研究生院",
    "quiz.details.program": "项目",
    "quiz.details.programPlaceholder": "例如 计算机科学硕士",
    "quiz.details.begin": "开始我的故事",
    "quiz.done.country": "国家",
    "quiz.done.city": "城市",
    "quiz.done.university": "大学",
    "quiz.done.degree": "阶段",
    "quiz.done.semesters": "停留时长",
    "degree.Undergraduate": "本科",
    "degree.Taught Master": "授课型硕士",
    "degree.Graduate": "研究生",
    "degree.PhD": "博士",
    "degree.Exchange Student": "交换生",
    "admission.department": "招生与人生模拟器",
    "admission.fallbackUniversity": "{city} 的一所大学",
    "admission.salutation": "亲爱的未来{grade}学生：",
    "admission.congrats": "恭喜！",
    "admission.bodyStart": "我们很高兴地通知你，招生委员会已决定录取你进入",
    "admission.toPursue": "攻读",
    "admission.inDepartment": "所在院系为",
    "admission.welcome": "欢迎来到 {university}！",
    "admission.tagline": "我们期待在 {country} {city} 见到你。",
    "admission.closing": "一段改变你的海外学习生活即将开始：新的日常、新的人，以及只有你能做出的选择。翻开下一页，旅程正式开始。",
    "admission.accept": "接受 offer",
    "admission.decline": "拒绝 offer",
    "timeskip.line1": "几个月过去了，你正在准备出发...",
    "timeskip.line2": "漫长夏天之后，搬家的日子终于到了...",
    "timeskip.line3": "你在 {city} 安顿下来，开始熟悉 {school}...",
    "timeskip.line4": "迎新周结束了，你的第一个学期即将开始...",
    "timeskip.schoolFallback": "{city} 的新学校",
    "timeskip.sub": "你的第一幕正在路上。",
    "error.title": "出错了",
    "error.tryAgain": "再试一次",
    "story.reused": "正在复用已经为这个完全相同档案生成过的故事，无需重新生成。",
    "story.gameOver": "你的{stat}耗尽了。",
    "story.gameOverEnding": "{reason} 你的留学故事在这里结束了；海外生活有时并不会完全按计划展开。",
    "stats.health": "健康",
    "stats.group": "人生状态",
    "stats.mood": "心情",
    "stats.money": "金钱",
    "stats.school": "学业",
    "scene.fieldNotes": "田野笔记",
    "scene.why": "为什么会发生",
    "scene.emptyNotes": "故事中的每个场景都基于对 {caption} 学生生活的实时研究生成。这里会解释这些挑战为什么会出现。",
    "scene.about": "关于这个故事",
    "scene.sources": "来源",
    "scene.choicePrompt": "你会怎么做？",
    "category.academics": "学业",
    "category.career": "职业",
    "category.housing": "住宿",
    "category.social": "社交生活",
    "category.events": "校园活动",
    "category.campus": "校园生活",
    "ending.postmarked": "寄自 {city}",
    "ending.title": "你的故事，已封存",
    "ending.fieldNote": "田野笔记",
    "ending.restart": "开启新篇章",
    "ending.save": "保存这个故事",
    "tone.hopeful": "充满希望",
    "tone.bittersweet": "苦乐参半",
    "tone.challenging": "充满挑战",
    "keepsake.title": "留学人生模拟器 - 你的故事，已封存",
    "keepsake.postmarked": "寄自 {country} {city}",
    "keepsake.tone": "结局基调：{tone}",
    "keepsake.fieldNote": "田野笔记 - 为什么会发生",
    "keepsake.about": "关于这个故事",
    "keepsake.stats": "最终状态",
    "keepsake.sources": "来源",
  },
};

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  entity: (text: string) => string;
  copy: (text: string) => string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  dateLocale: string;
  languageLabels: Record<Language, string>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function loadLanguage(): Language {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "zh" ? "zh" : "en"; }
  catch { return "en"; }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(loadLanguage);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = language === "zh" ? "留学人生模拟器" : "Future Life Simulator";
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const setLanguage = (next: Language) => {
      try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Session-only preference. */ }
      setLanguageState(next);
    };
    const t = (key: string, vars?: Record<string, string | number>) => {
      const template = translations[language][key] ?? translations.en[key] ?? (key.startsWith("degree.") ? key.slice(7) : key);
      if (!vars) return template;
      return Object.entries(vars).reduce(
        (current, [name, replacement]) => current.split(`{${name}}`).join(String(replacement)),
        template,
      );
    };
    return {
      language,
      setLanguage,
      t,
      dateLocale: DATE_LOCALES[language],
      languageLabels: language === "zh" ? { en: "英文", zh: "中文" } : { en: "English", zh: "Chinese" },
      entity: (text) => localizeEntity(text, language),
      copy: (text) => translateCopy(text, language),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside LanguageProvider");
  return context;
}
