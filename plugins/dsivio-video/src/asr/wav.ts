import { open } from "node:fs/promises";
/** Exact standard evidence WAV: PCM s16, mono, 16 kHz, a single nonempty data chunk. */
export async function standardWavSamples(path: string): Promise<number | undefined> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size, header = Buffer.alloc(12);
    if ((await file.read(header, 0, 12, 0)).bytesRead !== 12 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") return undefined;
    const end = header.readUInt32LE(4) + 8;
    if (end !== size || end < 12) return undefined;
    let validFormat = false, samples: number | undefined, offset = 12;
    for (; offset + 8 <= end;) {
      const chunk = Buffer.alloc(8);
      if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) return undefined;
      const length = chunk.readUInt32LE(4), name = chunk.toString("ascii", 0, 4);
      if (offset + 8 + length > end) return undefined;
      if (name === "fmt ") {
        if (validFormat || length < 16) return undefined;
        const format = Buffer.alloc(16);
        if ((await file.read(format, 0, 16, offset + 8)).bytesRead !== 16) return undefined;
        validFormat = format.readUInt16LE(0) === 1 && format.readUInt16LE(2) === 1 && format.readUInt32LE(4) === 16000 && format.readUInt32LE(8) === 32000 && format.readUInt16LE(12) === 2 && format.readUInt16LE(14) === 16;
        if (!validFormat) return undefined;
      } else if (name === "data") { if (length === 0 || length % 2 !== 0 || samples !== undefined) return undefined; samples = length / 2; }
      offset += 8 + length + length % 2;
    }
    return validFormat && offset === end ? samples : undefined;
  } finally { await file.close(); }
}
