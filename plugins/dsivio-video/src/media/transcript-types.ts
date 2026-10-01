// The transcript document written by `transcribe` and read by media sampling, alignment and captions.

export const TRANSCRIPT_FORMAT = "dsivio-video.transcript/1";

export interface TranscriptToken {
  text: string;
  /** Seconds on the source file's clock. Absent means not measured; never substitute 0. */
  startSec?: number;
  endSec?: number;
  confidence?: number;
}

export interface TranscriptBlock {
  text: string;
  startSec?: number;
  endSec?: number;
  tokens: TranscriptToken[];
}

export interface TranscriptDocument {
  format: typeof TRANSCRIPT_FORMAT;
  /** Absolute path of the transcribed file. */
  source: string;
  /** Lowercase 2–3 letter language code that was requested. */
  language: string;
  durationSec: number;
  blocks: TranscriptBlock[];
  /** Which engine produced it, e.g. `local-whisperx small cpu int8` or `dsivio …`. */
  engine: string;
}
