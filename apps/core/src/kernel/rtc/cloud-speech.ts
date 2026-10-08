import type { SpeechInput, SpeechRequest, SpeechResponse } from '@jarvis/contracts';
import { DEVELOPMENT_GATEWAY_TOKEN } from '../../runtime/config.ts';

/** Called only by an RTC agent whose session explicitly selected cloud speech. */
export async function cloudSpeech(request: SpeechInput, signal: AbortSignal): Promise<SpeechResponse> {
  const response = await fetch(new URL('/v1/speech', process.env.JARVIS_MODEL_GATEWAY_URL ?? 'http://127.0.0.1:7430'), {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.JARVIS_GATEWAY_TOKEN ?? DEVELOPMENT_GATEWAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...request, ...(request.operation === 'synthesize' ? { text: request.text.slice(0, 4096) } : {}), cloudConsent: true } satisfies SpeechRequest),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  });
  if (!response.ok) throw new Error('Cloud speech unavailable');
  return await response.json() as SpeechResponse;
}
