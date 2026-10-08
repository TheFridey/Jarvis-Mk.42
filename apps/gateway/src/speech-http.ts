import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SpeechRequest, SpeechResponse } from '@jarvis/contracts';
import { openaiSpeech } from './adapters/openai-speech.ts';

/** Separate from text inference: cloud model permission never implies audio consent. */
export async function speechHttp(req: IncomingMessage, res: ServerResponse, token: string,
  provider: (request: SpeechRequest, signal: AbortSignal) => Promise<SpeechResponse> = openaiSpeech): Promise<void> {
  res.setHeader('content-type', 'application/json');
  const fail = (status: number, error: string) => { res.statusCode = status; res.end(JSON.stringify({ error })); };
  if (req.headers.authorization !== `Bearer ${token}`) { fail(401, 'unauthorized'); return; }
  const abort = new AbortController();
  req.once('aborted', () => abort.abort());
  res.once('close', () => { if (!res.writableEnded) abort.abort(); });
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 2_000_000) { fail(413, 'request_too_large'); return; }
      chunks.push(bytes);
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail(400, 'invalid_speech_request'); return; }
    if (!value || typeof value !== 'object') { fail(400, 'invalid_speech_request'); return; }
    const input = value as Record<string, unknown>;
    if (input.cloudConsent !== true) { fail(403, 'cloud_speech_consent_required'); return; }
    const allowed = ['operation', 'cloudConsent', input.operation === 'recognize' ? 'audio' : 'text'];
    if (Object.keys(input).some(key => !allowed.includes(key)) ||
      !(input.operation === 'recognize' && typeof input.audio === 'string' && input.audio.length > 0 && input.audio.length <= 1_000_000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.audio) ||
        input.operation === 'synthesize' && typeof input.text === 'string' && input.text.length > 0 && input.text.length <= 4096)) {
      fail(400, 'invalid_speech_request'); return;
    }
    const result = await provider(input as SpeechRequest, AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]));
    if (!res.destroyed) res.end(JSON.stringify(result));
  } catch {
    if (!res.destroyed) fail(502, 'cloud_speech_unavailable');
  }
}
