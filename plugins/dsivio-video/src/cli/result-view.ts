import { isResourceRef, valueClass } from "../core/value.ts";
import { ResultsRepository } from "../build/results.ts";
import type { OperationEvidence, ResultManifest, ResultOutput } from "../build/results.ts";

export async function outputDescription(repository: ResultsRepository, manifest: ResultManifest, name: string, output: ResultOutput) {
  const historical = "forward" in output ? await repository.readOutput(output.forward.build, output.forward.output) : { type: output.type, value: { type: output.type, data: output.value } };
  return { name, nominalType: historical?.type ?? null, valueClass: historical ? valueClass(historical.value) : null, isTarget: manifest.targets.includes(name), ...(historical && isResourceRef(historical.value.data) ? { mime: historical.value.data.mime, bytes: historical.value.data.bytes } : {}), ...("forward" in output ? { forward: output.forward } : {}) };
}

export function evidenceLine(operation: OperationEvidence): string {
  const params = operation.summary.params;
  const parameters = params !== null && typeof params === "object" && !Array.isArray(params) ? Object.entries(params).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(" ") : "";
  return `${operation.outputs.join(", ")}  ${operation.backend ?? "local"}${operation.model ? ` ${operation.model}` : ""}${operation.task ? `  task ${operation.task}` : ""}${operation.receipt ? `  receipt ${operation.receipt}` : ""}  ${operation.phase}${parameters ? `  ${parameters}` : ""}${operation.progress ? `  ${operation.progress}` : ""}${operation.error ? `  ${operation.error.code}: ${operation.error.message}` : ""}`.replace(/[\r\n]+/g, " ");
}
