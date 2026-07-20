import type { StatBlock } from "../types";

export const DEFAULT_STATS: StatBlock = { health: 70, mood: 70, money: 70, school: 70 };

export function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function applyStatDelta(stats: StatBlock, delta?: StatBlock): StatBlock {
  // Defensive `?? DEFAULT_STATS[key]` fallbacks: legacy cached stories from
  // before the "school" stat existed have initial_stats missing that key
  // entirely, which otherwise turns stats.school + undefined into NaN forever
  // (clampStat can't rescue a NaN).
  return {
    health: clampStat((stats.health ?? DEFAULT_STATS.health) + (delta?.health ?? 0)),
    mood: clampStat((stats.mood ?? DEFAULT_STATS.mood) + (delta?.mood ?? 0)),
    money: clampStat((stats.money ?? DEFAULT_STATS.money) + (delta?.money ?? 0)),
    school: clampStat((stats.school ?? DEFAULT_STATS.school) + (delta?.school ?? 0)),
  };
}

export function getFailedStat(stats: StatBlock): keyof StatBlock | null {
  return (Object.keys(stats) as (keyof StatBlock)[]).find((key) => stats[key] <= 0) ?? null;
}
