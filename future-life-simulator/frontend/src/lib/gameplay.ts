import type { StatBlock } from "../types";

export const DEFAULT_STATS: StatBlock = { health: 70, mood: 70, money: 70 };

export function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function applyStatDelta(stats: StatBlock, delta?: StatBlock): StatBlock {
  return {
    health: clampStat(stats.health + (delta?.health ?? 0)),
    mood: clampStat(stats.mood + (delta?.mood ?? 0)),
    money: clampStat(stats.money + (delta?.money ?? 0)),
  };
}

export function getFailedStat(stats: StatBlock): keyof StatBlock | null {
  return (Object.keys(stats) as (keyof StatBlock)[]).find((key) => stats[key] <= 0) ?? null;
}
