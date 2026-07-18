import { useEffect, useState } from "react";
import type { EndingNode, StoryDocument, StoryNode } from "./types";

const TONE_COLORS: Record<string, string> = {
  hopeful: "#e6f4ea",
  bittersweet: "#f4ecd7",
  challenging: "#f7e0e0",
};

function isEnding(node: StoryNode | EndingNode): node is EndingNode {
  return (node as EndingNode).tone !== undefined;
}

export default function App() {
  const [presets, setPresets] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [currentNodeId, setCurrentNodeId] = useState<string>("A");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((list: string[]) => {
        setPresets(list);
        if (list.length > 0) setSelectedPreset(list[0]);
      })
      .catch(() => setError("Could not reach backend. Is it running on :3001?"));
  }, []);

  async function generate() {
    setLoading(true);
    setError(null);
    setStory(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preset", presetId: selectedPreset }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Generation failed");
      const doc: StoryDocument = await res.json();
      setStory(doc);
      const firstNodeId = Object.keys(doc.nodes)[0] ?? "A";
      setCurrentNodeId(firstNodeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!story) {
    return (
      <div style={{ maxWidth: 640, margin: "80px auto", fontFamily: "sans-serif" }}>
        <h1>Future Life Simulator</h1>
        <p>Pick a preset destination and generate your story.</p>
        <select value={selectedPreset} onChange={(e) => setSelectedPreset(e.target.value)}>
          {presets.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button onClick={generate} disabled={loading || !selectedPreset} style={{ marginLeft: 12 }}>
          {loading ? "Generating..." : "Generate Story"}
        </button>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </div>
    );
  }

  const node: StoryNode | EndingNode =
    story.nodes[currentNodeId] ?? story.endings[currentNodeId];

  if (!node) {
    return <div style={{ margin: 80 }}>Error: node "{currentNodeId}" not found in story.</div>;
  }

  const ending = isEnding(node) ? node : null;
  const bg = ending ? TONE_COLORS[ending.tone] ?? "#fff" : "#fff";

  return (
    <div style={{ maxWidth: 640, margin: "40px auto", fontFamily: "sans-serif", background: bg, padding: 24, borderRadius: 8 }}>
      <p style={{ fontSize: 12, opacity: 0.6 }}>
        {story.framework_type} — {story.framework_reason}
      </p>
      {node.has_image && node.image_url ? (
        <img src={node.image_url} alt="" style={{ width: "100%", borderRadius: 8, marginBottom: 16 }} />
      ) : node.has_image ? (
        <div style={{ height: 200, background: "#ddd", borderRadius: 8, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", fontStyle: "italic", color: "#888" }}>
          [image placeholder: {node.image_prompt}]
        </div>
      ) : null}

      <p style={{ lineHeight: 1.6 }}>{node.scene_text}</p>

      {ending ? (
        <div>
          <p style={{ fontWeight: "bold", textTransform: "uppercase" }}>Ending: {ending.tone}</p>
          <button onClick={() => { setStory(null); }}>Play Again</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(node as StoryNode).choices.map((choice, i) => (
            <button key={i} onClick={() => setCurrentNodeId(choice.next_node)}>
              {choice.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
