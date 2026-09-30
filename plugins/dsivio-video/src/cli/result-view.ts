import { isResourceRef, valueClass } from "../core/value.ts";
import { ResultsRepository } from "../build/results.ts";
import type { ResultManifest, ResultOutput } from "../build/results.ts";

export async function outputDescription(repository: ResultsRepository, manifest: ResultManifest, name: string, output: ResultOutput) {
  const historical = "forward" in output ? await repository.readOutput(output.forward.build, output.forward.output) : { type: output.type, value: { type: output.type, data: output.value } };
  return { name, nominalType: historical?.type ?? null, valueClass: historical ? valueClass(historical.value) : null, isTarget: manifest.targets.includes(name), ...(historical && isResourceRef(historical.value.data) ? { mime: historical.value.data.mime, bytes: historical.value.data.bytes } : {}), ...("forward" in output ? { forward: output.forward } : {}) };
}
