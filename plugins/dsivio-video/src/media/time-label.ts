// Source-time labels drawn with a built-in bitmap font, so evidence images and clips need no font files.

/** `HH:MM:SS.mmm`, with at least `hourDigits` hour digits. */
export function formatTime(seconds: number, hourDigits = 2): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(hourDigits, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

// 5×7 glyphs for the characters formatTime emits.
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
};
const SCALE = 3;
const PAD = 4;

export interface TimeLabel {
  width: number;
  height: number;
  /** Opaque RGBA: near-white glyphs on black. */
  rgba: Buffer;
}

/** The label image for `seconds`. Its width depends only on the text length, so a fixed `hourDigits` gives a fixed size. */
export function renderTimeLabel(seconds: number, hourDigits = 2): TimeLabel {
  const text = formatTime(seconds, hourDigits);
  const width = (text.length * 6 - 1) * SCALE + PAD * 2;
  const height = 7 * SCALE + PAD * 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let alpha = 3; alpha < rgba.length; alpha += 4) rgba[alpha] = 255;
  [...text].forEach((character, index) => {
    GLYPHS[character]!.forEach((row, y) => {
      for (let x = 0; x < 5; x++) {
        if (row[x] !== "1") continue;
        for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
          const offset = ((PAD + y * SCALE + dy) * width + PAD + index * 6 * SCALE + x * SCALE + dx) * 4;
          rgba.fill(245, offset, offset + 3);
        }
      }
    });
  });
  return { width, height, rgba };
}
