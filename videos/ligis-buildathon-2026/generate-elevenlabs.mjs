// Generate voiceover via ElevenLabs API and save per-line MP3s.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
  throw new Error("ELEVENLABS_API_KEY is not set");
}

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Adam
const LINES = [
  { id: "s1", text: "AI agents are getting smarter — but they're still anonymous." },
  { id: "s2", text: "A wallet isn't an identity. A prompt isn't a permission." },
  { id: "s3", text: "Ligis fixes that. Portable on-chain identity, plus signed, revocable capability credentials." },
  { id: "s4", text: "The same capability hash is recognized on Casper and on EVM." },
  { id: "s5", text: "On Casper Testnet, an agent mints its own identity." },
  { id: "s6", text: "The Trust Steward signs an EIP-712 credential, and the Casper contract recovers the issuer on-chain using secp256k1." },
  { id: "s7", text: "The Steward runs the full autonomous loop: boot, reason, gate, act, record — all on Casper." },
  { id: "s8", text: "That credential unlocks a paid x402 endpoint — credential verified, payment settled on Casper." },
  { id: "s9", text: "Ligis is live on Casper Testnet. Portable trust for the agent economy." },
];

const OUT_DIR = "/Users/udingethe/Dev/ligis/videos/ligis-buildathon-2026/audio";
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
