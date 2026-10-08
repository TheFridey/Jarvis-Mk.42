import { afterEach, describe, expect, it, vi } from 'vitest';
import { openaiSpeech } from './openai-speech.ts';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('speech provider adapter', () => {
  it('fails closed when provider credentials are absent', async () => {
    vi.stubEnv('OPENAI_API_KEY', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(openaiSpeech({ operation: 'synthesize', text: 'hello' }, new AbortController().signal)).rejects.toThrow('not configured');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends WAV multipart recognition and bounds the transcript', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only'); const fetcher = vi.fn(async () => Response.json({ text: 'x'.repeat(9000) })); vi.stubGlobal('fetch', fetcher);
    const result = await openaiSpeech({ operation: 'recognize', audio: Buffer.from('RIFF').toString('base64') }, new AbortController().signal);
    expect(result.text).toHaveLength(8192);
    const [url, options] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/audio/transcriptions'); const form = options.body as FormData;
    expect(await (form.get('file') as Blob).text()).toBe('RIFF'); expect(form.get('model')).toBeTruthy();
  });
  it('preserves mono int16 output and resamples 24 kHz to 16 kHz', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only'); const pcm = Buffer.alloc(12); [0, 1000, 2000, 3000, 4000, 5000].forEach((n, i) => pcm.writeInt16LE(n, i * 2));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(pcm)));
    const result = await openaiSpeech({ operation: 'synthesize', text: 'hello' }, new AbortController().signal);
    const output = Buffer.from(result.audio!, 'base64'); expect(output.length).toBe(8);
    expect([0, 1, 2, 3].map(i => output.readInt16LE(i * 2))).toEqual([0, 1500, 3000, 4500]);
  });
  it('rejects incomplete PCM samples', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only'); vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    await expect(openaiSpeech({ operation: 'synthesize', text: 'hello' }, new AbortController().signal)).rejects.toThrow('incomplete PCM');
  });
});
