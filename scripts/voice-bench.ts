/**
 * Bounded Kokoro performance investigation.
 *
 * Separates the costs the earlier audition folded together: model load, first synthesis (which includes
 * tokeniser and voice-asset work), and steady-state per-utterance inference. Tries the precisions the
 * Node binding actually exposes, and reports what execution providers this build can even see.
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/voice-bench.ts
 */
const SCRIPTS = [
  { name: 'short', text: 'Afternoon, mate.' },
  { name: 'greeting', text: "Afternoon, mate. Everything's running smoothly." },
  { name: 'summary', text: "I've checked the results. There are two things worth looking at before we move forward." },
  { name: 'technical', text: 'ScaleSmiths, PostgreSQL, OpenRouter, GPU, API, and JavaScript.' },
];
const VOICE = process.env.JARVIS_VOICE ?? 'bm_george';
const MODELS = [
  { label: 'q8', dtype: 'q8' },
  { label: 'fp32', dtype: 'fp32' },
];

const say = (line: string) => process.stdout.write(line + String.fromCharCode(10));

async function bench(label: string, dtype: string): Promise<void> {
  const { KokoroTTS } = await import('kokoro-js');
  const loadStart = Date.now();
  const model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: dtype as never, device: 'cpu' });
  const loadMs = Date.now() - loadStart;

  let firstMs = 0;
  let spoken = 0;
  let synthesis = 0;
  const rows: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const script of SCRIPTS) {
      const started = Date.now();
      const audio = await model.generate(script.text, { voice: VOICE as never, speed: 1 });
      const ms = Date.now() - started;
      const seconds = audio.audio.length / audio.sampling_rate;
      if (pass === 0) firstMs += ms;
      else { synthesis += ms; spoken += seconds; }
      if (pass === 1) rows.push(`    ${script.name}: ${ms} ms for ${seconds.toFixed(2)} s (RTF ${(ms / 1000 / seconds).toFixed(2)})`);
    }
  }
  say(`${label}: load ${loadMs} ms | first pass (cold-ish) ${firstMs} ms | warm ${(synthesis / 1000).toFixed(1)} s for ${spoken.toFixed(1)} s | warm RTF ${(synthesis / 1000 / spoken).toFixed(2)}`);
  for (const row of rows) say(row);
  const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));
  say(`${label}: rss ${rss} MB`);
}

async function main(): Promise<void> {
  const ort = await import('onnxruntime-node');
  say(`onnxruntime-node ${(ort as unknown as { env?: { versions?: { node?: string } } }).env?.versions?.node ?? 'unknown'}`);
  for (const model of MODELS) {
    try {
      await bench(model.label, model.dtype);
    } catch (error) {
      say(`${model.label}: failed — ${(error as Error).message.slice(0, 200)}`);
    }
  }
}

try {
  await main();
} catch (error) {
  say(`bench failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
