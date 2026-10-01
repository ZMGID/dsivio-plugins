import { copyFile, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DvError } from "../../core/errors.ts";
import { runTool } from "../../tools/index.ts";
import { transcribeAudio } from "../../asr/backend.ts";
import type { AsrReply, AsrSegment } from "../../asr/client.ts";
import { standardWavSamples } from "../../asr/wav.ts";
import { prepareOutput, publishFile } from "../../media/publish.ts";
import { TRANSCRIPT_FORMAT } from "../../media/transcript-types.ts";
import type { TranscriptBlock, TranscriptDocument, TranscriptToken } from "../../media/transcript-types.ts";
import { stringOption, usage } from "../options.ts";
import type { CliOptions } from "../options.ts";
import { result } from "../output.ts";

export function transcriptFromReply(reply: AsrReply, source: string, language: string, samples: number, engine: string): TranscriptDocument {
  const seconds = (value: number | undefined): number | undefined => {
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > samples / 16000) return undefined;
    const sample = Math.round(value * 16000);
    return sample >= 0 && sample <= samples ? sample / 16000 : undefined;
  };
  let segments: AsrSegment[] = reply.segments;
  if (!segments.some((segment) => segment.words.length > 0) && reply.words) segments = [{ text: "", words: reply.words }];
  const blocks = segments.map((segment): TranscriptBlock => {
    const tokens = segment.words.map((word): TranscriptToken => {
      let startSec = seconds(word.start);
      let endSec = seconds(word.end);
      if (word.start !== undefined && word.end !== undefined && word.end < word.start) { startSec = undefined; endSec = undefined; }
      return { text: word.text, ...(startSec !== undefined ? { startSec } : {}), ...(endSec !== undefined ? { endSec } : {}), ...(word.score !== undefined && Number.isFinite(word.score) && word.score >= 0 && word.score <= 1 ? { confidence: word.score } : {}) };
    });
    let startSec = seconds(segment.start);
    let endSec = seconds(segment.end);
    if (segment.start !== undefined && segment.end !== undefined && segment.end < segment.start) { startSec = undefined; endSec = undefined; }
    return { text: tokens.length > 0 ? tokens.map((word) => word.text).join(" ") : segment.text, tokens, ...(startSec !== undefined ? { startSec } : {}), ...(endSec !== undefined ? { endSec } : {}) };
  });
  return { format: TRANSCRIPT_FORMAT, source, language, durationSec: samples / 16000, engine, blocks };
}
export async function transcribeMedia(source: string, language: string, target: string, model = "local/whisperx-small"): Promise<{ source: string; language: string; durationSec: number; extracted: boolean; engine: string; blocks: number; words: number; output: string }> {
  if (!/^[a-z]{2,3}$/.test(language) || ["auto", "und"].includes(language)) throw new DvError("CLI_USAGE", "--language must be a lowercase two- or three-letter code (not auto or und).");
  const output = await prepareOutput(target);
  let input: string;
  try { input = await realpath(resolve(source)); if (!(await stat(input)).isFile()) throw new DvError("INVALID_INPUT", "Transcription input must be a regular file."); }
  catch (error) { if (error instanceof DvError) throw error; throw new DvError("INVALID_INPUT", `Cannot read transcription input: ${String(error)}`, { cause: error }); }
  const temporary = await mkdtemp(join(tmpdir(), "dsivio-video-asr-"));
  try {
    const audio = join(temporary, "audio.wav");
    let samples = await standardWavSamples(input);
    const extracted = samples === undefined;
    if (extracted) {
      await runTool("ffmpeg", ["-nostdin", "-v", "error", "-n", "-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audio]);
      samples = await standardWavSamples(audio);
    } else await copyFile(input, audio);
    if (samples === undefined) throw new DvError("INVALID_INPUT", "Audio extraction did not produce a non-empty 16 kHz mono 16-bit PCM WAV.");
    const { reply, engine } = await transcribeAudio(audio, language, samples, process.cwd(), temporary, model);
    const document = transcriptFromReply(reply, input, language, samples, engine);
    const transcript = join(temporary, "transcript.json");
    await writeFile(transcript, JSON.stringify(document, null, 2) + "\n", { flag: "wx" });
    await publishFile(transcript, output);
    return { source: input, language, durationSec: document.durationSec, extracted, engine, blocks: document.blocks.length, words: document.blocks.reduce((count, block) => count + block.tokens.length, 0), output };
  } catch (error) {
    if (error instanceof DvError) throw error;
    throw new DvError("TRANSCRIBE_FAILED", `Transcription failed: ${String(error)}`, { cause: error });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
export async function transcribeCommand(options: CliOptions): Promise<number> {
  const language = stringOption(options, "language");
  const target = stringOption(options, "to");
  if (!language || !target || options.positionals.length !== 1) usage("transcribe requires one input, --language and --to.");
  if (options.workspace || options.assetRoots.length > 0) usage("transcribe does not accept workspace or asset-root bindings.");
  const summary = await transcribeMedia(options.positionals[0]!, language, target, stringOption(options, "model"));
  result(options, { schema: "dsivio-video.transcribe-view/1", ...summary }, [`Transcribed ${summary.durationSec}s with ${summary.engine}`, `${summary.blocks} passages, ${summary.words} words → ${summary.output}`]);
  return 0;
}
