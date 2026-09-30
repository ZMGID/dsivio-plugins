// Read access to earlier Builds, used by planning to honour `<build-record>` candidates.

import type { TypeRef, Value } from "./value.ts";

export interface HistoricalOutput {
  type: TypeRef;
  value: Value;
}

export interface HistoryReader {
  /**
   * A public output saved by an earlier Build. Undefined when the Build or the output does not exist.
   * Throws DvError `HISTORY_OPEN` when that Build has not finished: only finished Results are reusable.
   * Resources in the value resolve in the same project store, so reuse never copies bytes.
   */
  readOutput(buildId: string, output: string): Promise<HistoricalOutput | undefined>;
}
