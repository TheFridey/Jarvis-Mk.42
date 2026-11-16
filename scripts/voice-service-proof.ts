/**
 * Proves the local speech service end to end, without a browser.
 *
 * Synthesises a two-sentence answer through the exact class the Kernel uses, reports time-to-first-chunk
 * and total time, writes the audio for listening, and then proves cancellation stops the stream early.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { KokoroSpeechService } from '../apps/core/src/kernel/voice/kokoro-speech-service.ts';

const OUT = '.logs/voice-proof';
const ANSWER = "Afternoon, mate. Everything's running smoothly. I've checked the results and there are two things worth looking at before we move forward.";

const say = (line: string) => process.stdout.write(line + String.fromCharCode(10));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const service = new KokoroSpeechService({});
  const loadStart = Date.now();
  await service.warm();
  say(`warm load: ${Date.now() - loadStart} ms`);

  const started = Date.now();
  const chunks: { index: number; seconds: number; bytes: number; firstAt?: number }[] = [];
  for await (const chunk of service.speak(ANSWER, { voice: 'bm_george' })) {
    chunks.push({ index: chunk.index, seconds: Number(chunk.seconds.toFixed(2)), bytes: chunk.wav.byteLength, firstAt: Date.now() - started });
    writeFileSync(`${OUT}/chunk-${chunk.index}.wav`, Buffer.from(chunk.wav));
    if (chunk.index === 0) say(`time to first chunk: ${Date.now() - started} ms (${chunk.seconds.toFixed(2)} s of audio)`);
  }
  const totalMs = Date.now() - started;
  const spoken = chunks.reduce((sum, chunk) => sum + chunk.seconds, 0);
  say(`chunks: ${chunks.length}, ${spoken.toFixed(2)} s of speech in ${totalMs} ms (RTF ${(totalMs / 1000 / spoken).toFixed(2)})`);
  for (const chunk of chunks) say(`  chunk ${chunk.index}: ${chunk.seconds} s / ${chunk.bytes} bytes`);

  // Cancellation: the second chunk must never arrive.
  const controller = new AbortController();
  let delivered = 0;
  for await (const chunk of service.speak(ANSWER, { signal: controller.signal })) {
    delivered++;
    if (chunk.index === 0) controller.abort();
  }
  say(`cancellation: ${delivered} chunk(s) after abort at chunk 0`);
  if (chunks.length > 0 && delivered !== 1) {
    say('CANCELLATION FAILED');
    process.exitCode = 1;
  }
}

try { await main(); } catch (error) { say(`proof failed: ${(error as Error).message}`); process.exitCode = 1; }
