import fs from "node:fs/promises";
import path from "node:path";
import type { StoryDocument, StoryNode } from "../src/types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripChoiceLeakage(text: string, node: StoryNode): string {
  const ids = node.choices.map((choice) => choice.logic_choice_id?.trim()).filter((id): id is string => Boolean(id));
  if (!ids.length) return text.trim();
  const block = new RegExp(`(?:\\r?\\n\\s*)+(?=(?:${ids.map(escapeRegExp).join("|")})\\s*[:：])[\\s\\S]*$`, "i");
  return text.replace(block, "").trim();
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error("Pass one or more cached story ids.");
  const root = path.resolve(process.cwd(), "..");
  for (const id of ids) {
    const files = [
      path.join(root, "data", "stories", `${id}_final.json`),
      path.join(root, "data", "runs", id, "09_final_story.json"),
    ];
    let repaired = 0;
    for (const file of files) {
      const doc = JSON.parse(await fs.readFile(file, "utf8")) as StoryDocument;
      for (const [nodeId, node] of Object.entries(doc.nodes)) {
        const cleaned = stripChoiceLeakage(node.scene_text, node);
        if (cleaned !== node.scene_text) {
          node.scene_text = cleaned;
          repaired += 1;
        }
        for (const variant of doc.logic_content_variants?.[nodeId] ?? []) {
          const legacyVariant = variant as typeof variant & { text?: string };
          const variantText = variant.scene_text ?? legacyVariant.text;
          if (!variantText) continue;
          const cleanedVariant = stripChoiceLeakage(variantText, node);
          if (cleanedVariant !== variantText) {
            if (variant.scene_text) variant.scene_text = cleanedVariant;
            if (legacyVariant.text) legacyVariant.text = cleanedVariant;
            repaired += 1;
          }
        }
      }
      await fs.writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify({ storyId: id, repaired }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
