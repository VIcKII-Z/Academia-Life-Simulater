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

function automaticSystemImagePrompt(doc: StoryDocument, nodeId: string, sceneText: string, kind: "warning" | "ending"): string {
  const profile = doc.user_profile;
  const location = [profile?.school, profile?.city, profile?.country].filter(Boolean).join(", ");
  const scene = sceneText.replace(/\s+/g, " ").slice(0, 320);
  const direction = kind === "warning"
    ? "Show a concrete moment of concern and practical risk awareness, not a symbolic alert screen."
    : "Show the concrete lived outcome of this route with a visually resolved emotional tone.";
  return `${location || "international study-abroad"} student scene, page ${nodeId}. ${direction} Story moment: ${scene}`;
}

function reuseDecisionImage(doc: StoryDocument, node: StoryDocument["nodes"][string]): void {
  if (!node.image_url || !Array.isArray(node.choices)) return;
  for (const choice of node.choices) {
    const resultPage = doc.nodes[choice.next_node];
    if (resultPage && resultPage.logic_page_role === "result") {
      resultPage.image_url = node.image_url;
    }
  }
}

function findPrecedingImage(doc: StoryDocument, targetNodeId: string): string | undefined {
  const nodes = Object.values(doc.nodes);
  const plannedPredecessor = nodes.find((node) =>
    node.image_url && node.choices?.some((choice) => choice.logic_planned_next_node === targetNodeId),
  );
  if (plannedPredecessor?.image_url) return plannedPredecessor.image_url;

  const directPredecessor = nodes.find((node) =>
    node.image_url && node.choices?.some((choice) => choice.next_node === targetNodeId),
  );
  return directPredecessor?.image_url;
}

function coverNarrativePages(
  doc: StoryDocument,
  narrativeEntries: Array<[string, StoryDocument["nodes"][string]]>,
  generatedEntries: Array<[string, StoryDocument["nodes"][string]]>,
): void {
  const generatedImages = generatedEntries
    .map(([, node]) => node.image_url)
    .filter((url): url is string => Boolean(url));

  for (const [index, [nodeId, node]] of narrativeEntries.entries()) {
    if (!node.image_url) {
      // Pages beyond the generation budget reuse the closest causal scene in
      // the logic graph. A deterministic generated fallback guarantees visual
      // coverage for a disconnected custom node without adding an API call.
      node.image_url = findPrecedingImage(doc, nodeId)
        ?? generatedImages[index % generatedImages.length];
    }
    reuseDecisionImage(doc, node);
  }
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

  const allEntries = [
    ...Object.entries(doc.nodes),
    ...Object.entries(doc.endings),
  ];
  const endingIds = new Set(Object.keys(doc.endings));
  const mandatorySystemEntries = allEntries.filter(([nodeId, node]) =>
    endingIds.has(nodeId) || node.logic_page_role === "warning",
  );
  for (const [nodeId, node] of mandatorySystemEntries) {
    const kind = endingIds.has(nodeId) ? "ending" : "warning";
    node.has_image = true;
    node.image_prompt ||= automaticSystemImagePrompt(doc, nodeId, node.scene_text, kind);
  }

  const narrativeAnchorEntries = Object.entries(doc.nodes).filter(([, node]) =>
    node.logic_page_role !== "warning" && node.has_image && node.image_prompt,
  );

  const maxImages = runtimeConfig?.features.maxImagesPerStory ?? config.features.maxImagesPerStory;
  const selectedNarrativeEntries = maxImages > 0 ? narrativeAnchorEntries.slice(0, maxImages) : [];
  const selectedEntries = [...selectedNarrativeEntries, ...mandatorySystemEntries];
  const entriesToGenerate = selectedEntries.filter(([, node]) => !node.image_url);
  if (entriesToGenerate.length > 0) {
    await fs.mkdir(ASSETS_DIR, { recursive: true });
    const client = getOpenAIClient(runtimeConfig, "image");
    for (const [nodeId, node] of entriesToGenerate) {
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

      if (nodeId in doc.nodes) reuseDecisionImage(doc, doc.nodes[nodeId]);
    }
  }

  // Restore local decision/result reuse for existing anchors, then give every
  // uncapped narrative page the image of its causal predecessor. This keeps
  // the API budget fixed while avoiding visible placeholder pages.
  coverNarrativePages(doc, narrativeAnchorEntries, selectedNarrativeEntries);

  return doc;
}
