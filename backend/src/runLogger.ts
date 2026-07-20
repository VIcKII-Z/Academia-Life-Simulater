import fs from "node:fs/promises";
import path from "node:path";

const RUNS_DIR = path.resolve(process.cwd(), "..", "data", "runs");

/**
 * Per-run debug logger: persists each pipeline stage's raw output to
 * /data/runs/{storyId}/ so the Search/Design/Artist agents' intermediate
 * results can be inspected after the fact, not just the final story JSON.
 *
 * Files written per run:
 *   00_meta.json            - mode, timestamps, presetId/profile
 *   01_search_report.json   - Search Agent output
 *   02_design_skeleton.json - Design Agent output (before images)
 *   03_artist_final.json    - Artist Agent output (final, with image_url)
 *   log.txt                 - human-readable timeline with stage durations
 */
export class RunLogger {
  private runDir: string;
  private logLines: string[] = [];
  private startTimes: Record<string, number> = {};

  constructor(private storyId: string) {
    this.runDir = path.join(RUNS_DIR, storyId);
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  async init(meta: Record<string, unknown>): Promise<void> {
    await fs.mkdir(this.runDir, { recursive: true });
    await this.writeJson("00_meta.json", { storyId: this.storyId, ...meta, startedAt: this.timestamp() });
    this.log(`Run started for story_id=${this.storyId}`);
  }

  startStage(stage: string): void {
    this.startTimes[stage] = Date.now();
    this.log(`[${stage}] started`);
    console.log(`[RunLogger] ${this.storyId} :: ${stage} started`);
  }

  async endStage(stage: string, filename: string, data: unknown): Promise<void> {
    const durationMs = Date.now() - (this.startTimes[stage] ?? Date.now());
    await this.writeJson(filename, data);
    this.log(`[${stage}] completed in ${durationMs}ms -> ${filename}`);
    console.log(`[RunLogger] ${this.storyId} :: ${stage} completed in ${durationMs}ms`);
  }

  async fail(stage: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.log(`[${stage}] FAILED: ${message}`);
    console.error(`[RunLogger] ${this.storyId} :: ${stage} FAILED: ${message}`);
    await this.flush();
  }

  private log(line: string): void {
    this.logLines.push(`${this.timestamp()} ${line}`);
  }

  async flush(): Promise<void> {
    await fs.mkdir(this.runDir, { recursive: true });
    await fs.writeFile(path.join(this.runDir, "log.txt"), this.logLines.join("\n") + "\n");
  }

  private async writeJson(filename: string, data: unknown): Promise<void> {
    await fs.writeFile(path.join(this.runDir, filename), JSON.stringify(data, null, 2));
  }
}

export async function listRuns(): Promise<string[]> {
  try {
    return await fs.readdir(RUNS_DIR);
  } catch {
    return [];
  }
}

export async function readRunFiles(storyId: string): Promise<Record<string, unknown>> {
  const dir = path.join(RUNS_DIR, storyId);
  const files = await fs.readdir(dir);
  const result: Record<string, unknown> = {};
  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), "utf-8");
    result[file] = file.endsWith(".json") ? JSON.parse(raw) : raw;
  }
  return result;
}
