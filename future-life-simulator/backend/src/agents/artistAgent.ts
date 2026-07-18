import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { StoryDocument } from "../types.js";

const ASSETS_DIR = path.resolve(process.cwd(), "..", "data", "assets", "generated");

/**
 * Mutates and returns the story doc with image_url populated for has_image nodes.
 * Skips entirely (no API calls) if config.features.enableImageGeneration is false —
 * nodes keep has_image as designed but simply have no image_url, and the frontend
 * renders a tone-based placeholder instead.
 */
export async function runArtistAgent(doc: StoryDocument): Promise<StoryDocument> {
  if (!config.features.enableImageGeneration) {
    return doc;
  }

  await fs.mkdir(ASSETS_DIR, { recursive: true });
  const client = getOpenAIClient();

  const allEntries = [
    ...Object.entries(doc.nodes),
    ...Object.entries(doc.endings),
  ].filter(([, node]) => node.has_image && node.image_prompt);

  const capped = allEntries.slice(0, config.features.maxImagesPerStory);

  for (const [nodeId, node] of capped) {
    const toneSuffix = "tone" in node ? `, ${(node as { tone: string }).tone} mood` : "";
    const prompt = `${node.image_prompt}${toneSuffix}`;
    const result = await client.images.generate({
      model: config.models.image,
      prompt,
      size: "1024x1024",
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) continue;

    const fileName = `${doc.story_id}_${nodeId}.png`;
    await fs.writeFile(path.join(ASSETS_DIR, fileName), Buffer.from(b64, "base64"));
    node.image_url = `/assets/generated/${fileName}`;
  }

  return doc;
}
