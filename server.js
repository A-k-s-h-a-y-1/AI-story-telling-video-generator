// ============================================================
// StoryFrame AI — Express Backend
// Handles AI story generation via Google Gemini API
// ============================================================

import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// ── Fallback stories (used when API key is missing or fails) ──
const FALLBACK_STORIES = [
  {
    title: "The Last Lighthouse",
    story: `At the edge of the world, where the ocean met the sky in an endless bruise of violet and silver, stood the last lighthouse on Earth. Its keeper, an old woman named Mara, had tended its flame for sixty years without a single night off.\n\nShe had watched ships come and go, storms rise and collapse, and the stars wheel overhead in their ancient, indifferent dance. But tonight was different. Tonight, the sea was speaking.\n\nThe waves formed words — slow, deliberate, carved in foam. "Your light," they said, "has been our guide. But now we guide you." And from the depths rose something luminous, something the ocean had been keeping safe for centuries: every wish that sailors had ever cast into its waters, preserved in amber and light.\n\nMara descended the spiral stairs for the first time in years. She walked into the surf. She was not afraid. She had always known the sea would call her home eventually — she just hadn't expected it to say thank you first.`,
    mood: "mysterious",
    keywords: ["lighthouse", "ocean", "keeper", "light", "waves", "night"]
  },
  {
    title: "The Memory Thief",
    story: `There was a thief in the city who stole only memories. Not the grand ones — first kisses, graduations, the faces of the dead — but the small ones. The smell of rain on hot pavement. The feeling of cold tile under bare feet at 3am. The sound a spoon makes against the side of a ceramic bowl.\n\nPeople never noticed what was missing. They simply felt, over time, a vague and puzzling lightness, as if life had become slightly less textured.\n\nThe thief kept the memories in glass jars arranged on shelves that stretched ceiling to floor. On lonely nights, she would open one — just the seal, just enough — and breathe in someone else's ordinary Tuesday. It was, she had decided, the only form of immortality available to someone like her.\n\nBut the jars were getting full. And the people outside were getting empty. And one morning she woke to find her own shelves bare, and could not remember why she had started collecting in the first place.`,
    mood: "melancholic",
    keywords: ["memory", "thief", "jars", "city", "lonely", "light"]
  }
];

// ── Gemini model names to try in order ───────────────────────
// Google periodically renames/deprecates models; we try each until one works.
const GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b-latest",
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash",
  "gemini-pro",
];

// ── Gemini API helper ─────────────────────────────────────────
async function generateWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new Error("NO_API_KEY");
  }

  const systemInstruction = `You are a literary AI storyteller who crafts vivid, atmospheric short stories. 
Given a prompt, generate a complete story with the following JSON structure (respond ONLY with valid JSON, no markdown):
{
  "title": "Story title (5 words or fewer)",
  "story": "Full story text (300-500 words, literary quality, rich imagery)",
  "mood": "One word mood: mysterious | joyful | melancholic | thrilling | whimsical | dark | hopeful",
  "keywords": ["5-7 key visual nouns or concepts from the story"]
}`;

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ parts: [{ text: `Story prompt: ${prompt}` }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 1024,
      responseMimeType: "application/json"
    }
  });

  let lastError = null;

  // Try each model name until one succeeds
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });

      const data = await response.json();

      // If model not found, try next one silently
      if (!response.ok) {
        const msg = data?.error?.message || `HTTP ${response.status}`;
        const isModelError = msg.toLowerCase().includes("not found") || 
                             msg.toLowerCase().includes("not supported") ||
                             response.status === 404;
        if (isModelError) {
          console.log(`[StoryFrame] Model "${model}" unavailable, trying next…`);
          lastError = new Error(msg);
          continue;
        }
        // Non-model error (auth, quota, etc.) — throw immediately
        throw new Error(msg);
      }

      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) throw new Error("Empty response from Gemini");

      console.log(`[StoryFrame] ✓ Used model: ${model}`);

      // Strip any accidental markdown fences
      const clean = raw.replace(/```json|```/gi, "").trim();
      return JSON.parse(clean);

    } catch (err) {
      // Re-throw non-model errors immediately
      if (!err.message.toLowerCase().includes("not found") &&
          !err.message.toLowerCase().includes("not supported")) {
        throw err;
      }
      lastError = err;
    }
  }

  // All models failed
  throw lastError || new Error("No available Gemini models found.");
}

// ── /chat route ───────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
    return res.status(400).json({ error: "Please provide a story prompt (at least 3 characters)." });
  }

  console.log(`[StoryFrame] Generating story for: "${prompt.slice(0, 60)}..."`);

  try {
    const result = await generateWithGemini(prompt.trim());
    console.log(`[StoryFrame] ✓ Story generated: "${result.title}"`);
    return res.json({ success: true, ...result });

  } catch (err) {
    console.warn(`[StoryFrame] AI failed (${err.message}), using fallback.`);

    // Use a random fallback story
    const fallback = FALLBACK_STORIES[Math.floor(Math.random() * FALLBACK_STORIES.length)];
    return res.json({
      success: true,
      fallback: true,
      fallbackReason: err.message === "NO_API_KEY"
        ? "No API key configured — showing demo story."
        : `API error: ${err.message} — showing demo story.`,
      ...fallback
    });
  }
});

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✨ StoryFrame AI running at http://localhost:${PORT}`);
  console.log(`   API Key: ${process.env.GEMINI_API_KEY ? "✓ Configured" : "✗ Not set (fallback mode)"}\n`);
});
