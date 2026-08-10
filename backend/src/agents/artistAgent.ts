import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { config } from "../config/config.js";
import { getOpenAIClient, getRuntimeModel } from "./openaiClient.js";
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
const IMAGE_SIZE = "1536x1024" as const;

const EAST_ASIAN_PROTAGONIST =
  "The protagonist is always the same 24-year-old Chinese East Asian woman: oval face, warm light-medium skin, " +
  "straight shoulder-length black hair with a clean side part, dark-brown almond-shaped eyes, thin round dark-green glasses, " +
  "and a navy canvas backpack with one small yellow keychain. Keep her face, age, skin tone, hairstyle, glasses, and backpack " +
  "identical in every illustration.";

const SRI_LANKAN_PROTAGONIST =
  "The protagonist is always the same 24-year-old Sri Lankan South Asian woman: oval face, warm medium-deep brown skin, " +
  "dark-brown almond-shaped eyes, long wavy black hair tied in one low braid, small gold stud earrings, a teal scarf, " +
  "and a navy canvas backpack with one small yellow keychain. Keep her face, age, skin tone, hairstyle, earrings, scarf, " +
  "and backpack identical in every illustration.";

function stylePrefix(runtimeConfig?: RuntimeConfig): string {
  const protagonist = runtimeConfig?.outputLanguage === "zh" ? EAST_ASIAN_PROTAGONIST : SRI_LANKAN_PROTAGONIST;
  return (
    "Create a 3:2 landscape illustration composed specifically for a 1536x1024 frame. " +
    "Keep the protagonist and all important action inside the central safe area; use a medium or wide shot, never an extreme close-up. " +
    `${protagonist} ` +
    "Warm hand-drawn storybook illustration in soft watercolor and colored-pencil style, gentle natural lighting, " +
    "cozy muted earthy palette, delicate linework, fine detail, subtle grain, and one consistent picture-book series aesthetic. " +
    "Show one concrete scene unique to this page. No text, captions, logos, watermark, photorealism, character sheet, collage, or split panel. Scene: "
  );
}

/**
 * Mutates and returns the story doc with image_url populated for generated
 * anchors and their directly-owned option-result pages.
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
  const client = getOpenAIClient(runtimeConfig, "image");

  const allEntries = [
    ...Object.entries(doc.nodes),
    ...Object.entries(doc.endings),
  ];
  const anchorEntries = allEntries.filter(([, node]) => node.has_image && node.image_prompt);

  const maxImages = runtimeConfig?.features.maxImagesPerStory ?? config.features.maxImagesPerStory;
  const capped = maxImages > 0 ? anchorEntries.slice(0, maxImages) : [];
  for (const [nodeId, node] of capped) {
    const toneSuffix = "tone" in node ? `, ${(node as { tone: string }).tone} mood` : "";
    const prompt = `${stylePrefix(runtimeConfig)}${node.image_prompt}${toneSuffix}`;
    const result = await client.images.generate({
      model: getRuntimeModel(runtimeConfig, "image"),
      prompt,
      size: IMAGE_SIZE,
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) continue;

    const imageFingerprint = createHash("sha256")
      .update(`${IMAGE_SIZE}\n${prompt}`)
      .digest("hex")
      .slice(0, 10);
    const fileName = `${doc.story_id}_${nodeId}_${imageFingerprint}.png`;
    await fs.writeFile(path.join(ASSETS_DIR, fileName), Buffer.from(b64, "base64"));
    node.image_url = `/assets/generated/${fileName}`;

    // Reuse is intentionally local: a decision illustration may carry across
    // its own immediate option-result pages, because they are continuations of
    // the same scene. Do not spread it to unrelated later nodes, warnings, or
    // endings merely because they happen to be nearby in object order.
    if ("choices" in node && Array.isArray(node.choices)) {
      for (const choice of node.choices) {
        const resultPage = doc.nodes[choice.next_node];
        if (resultPage && resultPage.logic_page_role === "result") {
          resultPage.image_url = node.image_url;
        }
      }
    }
  }

  return doc;
}
