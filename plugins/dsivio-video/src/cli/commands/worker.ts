import { runWorker } from "../../build/worker.ts";
import type { CliOptions } from "../options.ts";
import { integer } from "../options.ts";
import { openWorkspace } from "../project.ts";
export async function workerCommand(options: CliOptions): Promise<number> {
  const controller = new AbortController();
  const stop = (): void => { controller.abort(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await runWorker(openWorkspace(options), { signal: controller.signal, idleTimeoutMs: integer(process.env.DSIVIO_VIDEO_WORKER_IDLE_MS, "worker-idle-ms", 30_000) });
    return 0;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
