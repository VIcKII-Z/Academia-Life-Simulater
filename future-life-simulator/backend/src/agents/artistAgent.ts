import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/config.js";
import { getOpenAIClient } from "./openaiClient.js";
import type { RuntimeConfig, StoryDocument } from "../types.js";

const ASSETS_DIR = path.resolve(process.cwd(), "..", "data", "assets", "generated");

/**
 * Shared visual style prefix applied to every generated scene image so the
 * whole story reads as one illustrated picture-book. Matches the reference art
 * direction: warm, hand-drawn storybook illustration — soft watercolor and
 * colored-pencil rendering, gentle natural light, cozy and detailed but not
 * photorealistic. Kept as a constant (not per-node) so tone/scene vary while
 * the medium and mood stay consistent across the run.
 */
const STYLE_PREFIX =
  "Warm hand-drawn storybook illustration in soft watercolor and colored-pencil style, " +
  "gentle natural lighting, cozy muted earthy palette, delicate linework and fine detail, " +
  "picture-book / graphic-novel aesthetic, tender and cinematic mood, subtle grain, " +
  "no text, no captions, no watermark, no photorealism. Scene: ";

/**
 * Mutates and returns the story doc with image_url populated for has_image nodes.
 * Skips entirely (no API calls) if config.features.enableImageGeneration is false —
 * nodes keep has_image as designed but simply have no image_url, and the frontend
 * renders a tone-based placeholder instead.
 */
export async function runArtistAgent(doc: StoryDocument, runtimeConfig?: RuntimeConfig): Promise<StoryDocument> {
  const imageGenerationEnabled =
    runtimeConfig?.features.enableImageGeneration ?? config.features.enableImageGeneration;
  if (!imageGenerationEnabled) {
    return doc;
  }

  await fs.mkdir(ASSETS_DIR, { recursive: true });
  const client = getOpenAIClient(runtimeConfig);

  const allEntries = [
    ...Object.entries(doc.nodes),
    ...Object.entries(doc.endings),
  ].filter(([, node]) => node.has_image && node.image_prompt);

  const capped = allEntries.slice(0, runtimeConfig?.features.maxImagesPerStory ?? config.features.maxImagesPerStory);

  for (const [nodeId, node] of capped) {
    const toneSuffix = "tone" in node ? `, ${(node as { tone: string }).tone} mood` : "";
    const prompt = `${STYLE_PREFIX}${node.image_prompt}${toneSuffix}`;
    const result = await client.images.generate({
      model: runtimeConfig?.models.image ?? config.models.image,
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
