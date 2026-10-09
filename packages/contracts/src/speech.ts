/** Provider-neutral RTC speech. PCM output is mono signed int16 LE at 16 kHz. */
export type SpeechInput = { operation: 'recognize'; audio: string } | { operation: 'synthesize'; text: string };
export type SpeechRequest = SpeechInput & { cloudConsent: true };
export interface SpeechResponse { text?: string; audio?: string }
