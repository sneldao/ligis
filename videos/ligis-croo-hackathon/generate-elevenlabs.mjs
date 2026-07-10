// Generate voiceover via ElevenLabs API and save per-line MP3s.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
  throw new Error("ELEVENLABS_API_KEY is not set");
}

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Adam
const LINES = [
  { id: "s1", text: "Agents can hire agents on CROO — but who verifies the counterparty?" },
  { id: "s2", text: "Ligis is the trust layer. Callable on the CROO Agent Store, priced in USDC." },
  { id: "s3", text: "Negotiate, pay, deliver — the full CAP lifecycle. Your agent hires Ligis before releasing funds." },
  { id: "s4", text: "A buyer agent calls ligis.risk. CROO settles the payment on-chain." },
  { id: "s5", text: "Ligis returns pass, warn, or fail — plus a zero-to-one-hundred risk score." },
  { id: "s6", text: "Every verdict is backed by a live read of CredentialRegistry on Casper Testnet — the same contracts from our Casper Buildathon demo." },
  { id: "s7", text: "Three services: risk check, verify, and issue. Infrastructure for the agent economy." },
  { id: "s8", text: "Ligis on CROO. Don't pay an agent until Ligis proves it's credentialed." },
];

const OUT_DIR = "/Users/udingethe/Dev/ligis/videos/ligis-croo-hackathon/audio";
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
