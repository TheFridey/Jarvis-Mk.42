/**
 * Voice audition: synthesise the same five scripts with each candidate voice, locally.
 *
 * Nothing here touches a network service at synthesis time; the model is fetched once from the
 * Hugging Face mirror by kokoro-js and then runs on onnxruntime-node's arm64 build. Output is WAV so the
 * owner can listen, and the timings are printed so the choice is not made on adjectives alone.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const SCRIPTS: { name: string; text: string }[] = [
  { name: 'greeting', text: "Afternoon, mate. Everything's running smoothly." },
  { name: 'summary', text: "I've checked the results. There are two things worth looking at before we move forward." },
  { name: 'milestone', text: "That's a proper milestone. The important part is what you've actually demonstrated, not just what you've implemented." },
  { name: 'advice', text: "There are a few different ways we could approach this. I'd start with the simplest one that gives us reliable evidence." },
  { name: 'technical', text: 'ScaleSmiths, PostgreSQL, OpenRouter, GPU, API, and JavaScript.' },
];

const VOICES = (process.env.JARVIS_AUDITION_VOICES ?? 'bm_george,bm_lewis,bm_fable').split(',').map(value => value.trim()).filter(Boolean);
const OUT = 'docs/evidence/resonance-iii/audition';

const say = (line: string) => process.stdout.write(line + String.fromCharCode(10));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const { KokoroTTS } = await import('kokoro-js');
  // q8 keeps the model ~90 MB and is the difference between usable and not on a 16 GB ARM64 laptop.
  const model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
  say(`model loaded in ${Date.now() - started} ms`);

  const rows: { voice: string; script: string; ms: number; seconds: number; bytes: number }[] = [];
  for (const voice of VOICES) {
    for (const script of SCRIPTS) {
      const begin = Date.now();
      const audio = await model.generate(script.text, { voice: voice as never, speed: 1 });
      const ms = Date.now() - begin;
      const path = `${OUT}/${voice}-${script.name}.wav`;
      // The library hands back a WAV buffer; write it as-is so the sample is exactly what was generated.
      writeFileSync(path, Buffer.from(audio.toWav()));
      const seconds = audio.audio.length / audio.sampling_rate;
      rows.push({ voice, script: script.name, ms, seconds: Number(seconds.toFixed(2)), bytes: Buffer.from(audio.toWav()).length });
      say(`${voice} ${script.name}: ${ms} ms for ${seconds.toFixed(2)} s audio`);
    }
  }
  writeFileSync(`${OUT}/timings.json`, JSON.stringify({ generatedAt: new Date().toISOString(), model: 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: 'q8', device: 'cpu', rows }, null, 2));
  const total = rows.reduce((sum, row) => sum + row.ms, 0);
  const spoken = rows.reduce((sum, row) => sum + row.seconds, 0);
  say(`total ${rows.length} samples: ${(total / 1000).toFixed(1)} s synthesis for ${spoken.toFixed(1)} s of speech (RTF ${(total / 1000 / spoken).toFixed(2)})`);
}

try {
  await main();
} catch (error) {
  say(`audition failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
