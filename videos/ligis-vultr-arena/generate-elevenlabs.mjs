// Generate voiceover via ElevenLabs API and save per-line MP3s.
// Reads voiceover.txt (format: "s1 | line text") — the single source of truth.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
  throw new Error("ELEVENLABS_API_KEY is not set");
}

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Adam
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "audio");

// Parse voiceover.txt -> [{ id, text }]
const LINES = readFileSync(join(HERE, "voiceover.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && l.includes("|"))
  .map((l) => {
    const [id, ...rest] = l.split("|");
    return { id: id.trim(), text: rest.join("|").trim() };
  });

mkdirSync(OUT_DIR, { recursive: true });

async function synthesize(line) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
  const body = {
    text: line.text,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.38,
      similarity_boost: 0.75,
      style: 0.2,
      use_speaker_boost: true,
      speed: Number(process.env.VO_SPEED || 1.08),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${text}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const path = `${OUT_DIR}/${line.id}.mp3`;
  writeFileSync(path, buffer);
  console.log(`wrote ${path} (${buffer.length} bytes)`);
}

async function main() {
  console.log(`Synthesizing ${LINES.length} lines -> ${OUT_DIR}`);
  for (const line of LINES) {
    await synthesize(line);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
