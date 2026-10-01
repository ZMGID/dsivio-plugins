import { DvError } from "../core/errors.ts";
import { tokenAnchorKey } from "./identity.ts";
import { validateAdjustment, validateSemanticTake } from "./validate.ts";
import type { Adjustment, SemanticTake } from "./types.ts";

export function adjustTake(source: SemanticTake, adjustment: Adjustment): SemanticTake {
  validateSemanticTake(source);
  validateAdjustment(adjustment);
  if (adjustment.storyKey !== source.storyKey || !adjustment.edits.length) throw new DvError("ADJUST_STORY", "Adjustment requires the same Narrative and at least one edit");
  const anchorFrames = { ...source.anchorFrames }; const seen = new Set<string>();
  for (const edit of adjustment.edits) {
    if (!Object.hasOwn(anchorFrames, edit.anchorKey) || seen.has(edit.anchorKey)) throw new DvError("ADJUST_ANCHOR", `Unknown or duplicate local anchor '${edit.anchorKey}'`);
    if (!Number.isSafeInteger(edit.localFrame) || edit.localFrame < 0 || edit.localFrame > source.media.totalFrames) throw new DvError("ADJUST_FRAME", "Adjustment frame must be in the local media domain");
    seen.add(edit.anchorKey); anchorFrames[edit.anchorKey] = edit.localFrame;
  }
  const tokens = source.tokens.map(token => ({ tokenKey: token.tokenKey, frames: { start: anchorFrames[tokenAnchorKey(token.tokenKey, "start")]!, end: anchorFrames[tokenAnchorKey(token.tokenKey, "end")]! } }));
  const result = { ...source, tokens, anchorFrames }; validateSemanticTake(result); return result;
}
