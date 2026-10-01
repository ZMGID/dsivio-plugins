import { copyFile, mkdtemp, open, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DvError } from "../../core/errors.ts";
import { runTool } from "../../tools/index.ts";
import { runDsivio } from "../../gateway/dsivio.ts";
import { parseAsrReply, record } from "../../asr/client.ts";
import type { AsrReply, AsrSegment } from "../../asr/client.ts";
import { transcribeLocal } from "../../asr/service.ts";
import { prepareOutput, publishFile } from "../../media/publish.ts";
import { TRANSCRIPT_FORMAT } from "../../media/transcript-types.ts";
import type { TranscriptBlock, TranscriptDocument, TranscriptToken } from "../../media/transcript-types.ts";
import { stringOption, usage } from "../options.ts";
import type { CliOptions } from "../options.ts";
import { result } from "../output.ts";

export async function standardWavSamples(path: string): Promise<number | undefined> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const header = Buffer.alloc(12);
    if ((await file.read(header, 0, 12, 0)).bytesRead !== 12 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") return undefined;
    const end = header.readUInt32LE(4) + 8;
    if (end > size || end < 12) return undefined;
    let validFormat = false;
    let samples: number | undefined;
    for (let offset = 12; offset + 8 <= end;) {
      const chunk = Buffer.alloc(8);
      if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) return undefined;
      const length = chunk.readUInt32LE(4);
      if (offset + 8 + length > end) return undefined;
      const name = chunk.toString("ascii", 0, 4);
      if (name === "fmt ") {
        if (length < 16) return undefined;
        const format = Buffer.alloc(16);
        await file.read(format, 0, 16, offset + 8);
        validFormat = format.readUInt16LE(0) === 1 && format.readUInt16LE(2) === 1 && format.readUInt32LE(4) === 16000 && format.readUInt32LE(8) === 32000 && format.readUInt16LE(12) === 2 && format.readUInt16LE(14) === 16;
      } else if (name === "data") {
        if (length === 0 || length % 2 !== 0 || samples !== undefined) return undefined;
        samples = length / 2;
      }
      offset += 8 + length + (length % 2);
    }
    return validFormat ? samples : undefined;
  } finally { await file.close(); }
}
export function transcriptFromReply(reply: AsrReply, source: string, language: string, samples: number, engine: string): TranscriptDocument {
  const seconds = (value: number | undefined): number | undefined => {
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > samples / 16000) return undefined;
    const sample = Math.round(value * 16000);
    return sample >= 0 && sample <= samples ? Math.round(sample / 16) / 1000 : undefined;
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
  return { format: TRANSCRIPT_FORMAT, source, language, durationSec: Math.round(samples / 16) / 1000, engine, blocks };
}
export async function transcribeMedia(source: string, language: string, target: string): Promise<{ source: string; language: string; durationSec: number; extracted: boolean; engine: string; blocks: number; words: number; output: string }> {
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
    let reply: AsrReply | undefined;
    let engine = "";
    try {
      const response = await runDsivio(["media", "transcribe", audio, "--language", language, "--json"], process.cwd(), AbortSignal.timeout(600_000));
      if (response.code === 0) {
        let value: unknown;
        try { value = JSON.parse(response.stdout); }
        catch (error) { throw new DvError("ASR_RESPONSE_INVALID", "Dsivio transcription did not return valid JSON.", { cause: error }); }
        reply = parseAsrReply(record(value) && record(value.result) ? value.result : value);
        engine = "dsivio";
      } else if (!(response.code === 2 || response.code === 6 || /unknown (subcommand|command)|unrecognized (subcommand|command)|usage:/i.test(response.stderr + response.stdout))) {
        throw new DvError("GATEWAY_COMMAND_FAILED", `Dsivio transcription exited ${response.code}: ${response.stderr || response.stdout}`);
      }
    } catch (error) { if (!(error instanceof DvError) || error.code !== "GATEWAY_UNAVAILABLE") throw error; }
    if (!reply) {
      const local = await transcribeLocal(audio, language);
      reply = local.reply;
      engine = `local-whisperx ${local.health.model} ${local.health.device} ${local.health.compute}`;
    }
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
  const summary = await transcribeMedia(options.positionals[0]!, language, target);
  result(options, { schema: "dsivio-video.transcribe-view/1", ...summary }, [`Transcribed ${summary.durationSec}s with ${summary.engine}`, `${summary.blocks} passages, ${summary.words} words → ${summary.output}`]);
  return 0;
}
