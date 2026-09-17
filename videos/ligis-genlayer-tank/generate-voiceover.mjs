// Generate voiceover via ElevenLabs API and save per-line MP3s.
import { writeFileSync, mkdirSync } from "node:fs";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
  throw new Error("ELEVENLABS_API_KEY is not set");
}

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Adam
const LINES = [
  {
    id: "s1",
    text: "Agent A hires Agent B. A wallet isn't trust.",
  },
  {
    id: "s2",
    text: "Ligis answers first — a deterministic gate on Casper. One on-chain read: GO or STOP. From chain state, not a server.",
  },
  {
    id: "s3",
    text: "The gate receipt goes to GenLayer. create_job locks the stake and stores the Ligis proof on-chain. The seller delivers. The buyer disputes.",
  },
  {
    id: "s4",
    text: "GenLayer validators fetch the deliverable from the web, and each one asks an LLM: does this meet the brief? They agree on the verdict — not the reasoning. This resolve came back undetermined. A real adjudication outcome.",
  },
  {
    id: "s5",
    text: "Without GenLayer, there is no deterministic fallback for: was the delivery good enough? That is the gap Intelligent Contracts fill.",
  },
  {
    id: "s6",
    text: "One stack. Ligis gates who may trade. GenLayer adjudicates what happened. Live on Studio Next.",
  },
];

const OUT_DIR = "/Users/udingethe/Dev/ligis/videos/ligis-genlayer-tank/audio";
mkdirSync(OUT_DIR, { recursive: true });

async function synthesize(line) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
  const body = {
    text: line.text,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.35,
      similarity_boost: 0.75,
      style: 0.30,
      use_speaker_boost: true,
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
  for (const line of LINES) {
    await synthesize(line);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
