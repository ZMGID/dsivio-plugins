import { relative, sep } from "node:path";
import { isPending, isResourceRef, resourcesIn } from "../core/value.ts";
import type { Json } from "../core/value.ts";
import type { PreparedRun } from "./project.ts";
import type { CliOptions } from "./options.ts";

function describe(value: Json, resourceNames: ReadonlyMap<string, string>): string {
  if (isPending(value)) return `waiting for ${value.$pending}`;
  if (isResourceRef(value)) {
    return `${resourceNames.get(value.$resource) ?? "resource"} (${value.mime}, ${value.bytes} bytes)`;
  }
  if (Array.isArray(value)) return value.map((item) => describe(item, resourceNames)).filter(Boolean).join(", ");
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => {
    const description = describe(item, resourceNames);
    return description ? [`${key}=${description}`] : [];
  }).join(", ");
  return String(value);
}
function futureInputs(value: Json, path = ""): { role: string; output: string }[] {
  if (isPending(value)) return [{ role: path, output: value.$pending }];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => futureInputs(item, path ? `${path}.${key}` : key));
}
export function planView(prepared: PreparedRun, options: CliOptions) {
  const { plan, needs } = prepared;
  const resourceNames = new Map<string, string>();
  for (const [id, asset] of plan.assets) resourceNames.set(id, relative(prepared.workspace.root, asset.path).split(sep).join("/"));
  for (const [name, binding] of Object.entries(plan.definition.outputs)) {
    const seed = plan.definition.seeds[binding.record];
    if (seed) for (const { ref } of resourcesIn(seed.data)) if (!resourceNames.has(ref.$resource)) resourceNames.set(ref.$resource, name);
  }
  const requests = needs.filter((need) => need.kind === "request");
  const rejected = requests.filter((need) => !need.resolution.ok);
  const issues = needs.filter((need) => need.kind === "issue");
  const waiting = needs.filter((need) => need.kind === "waiting");
  const valid = rejected.length === 0 && issues.length === 0;
  const diagnosticRows = [...rejected.map((need) => need.resolution), ...issues.map((issue) => ({ code: issue.code, reason: issue.message, step: issue.step }))];
  const requestRows = requests.map((need) => {
    const resolution = need.resolution;
    return { needKey: `${need.step}:${need.port}`, stepLabel: need.label, portName: need.port, capabilityName: need.capability,
      ...(resolution.ok ? { backend: resolution.backend, endpointName: resolution.backend, model: resolution.summary.model, parameterSummary: resolution.summary, request: resolution.request, futureInputs: futureInputs(resolution.request), cost: resolution.cost } : { code: resolution.code, reason: resolution.reason }) };
  });
  const paidNeedTotal = requests.filter((need) => need.resolution.ok && need.resolution.cost === "paid").length;
  const localNeedTotal = requests.filter((need) => need.resolution.ok && need.resolution.cost === "local").length;
  const lines = [`Run: ${plan.definition.run}`, `Targets: ${plan.definition.targets.join(", ")}`];
  for (const need of needs) {
    if (need.kind === "waiting") {
      lines.push(`Step ${need.label}: waiting for ${need.waitingFor.join(", ")}; requests will be checked before submission.`);
      continue;
    }
    if (need.kind === "issue") {
      lines.push(`Step ${need.label}: rejected ${need.code}: ${need.message}`);
      continue;
    }
    const resolution = need.resolution;
    lines.push(`Need ${need.label}.${need.port} — ${need.capability}`);
    if (!resolution.ok) { lines.push(`  rejected ${resolution.code}: ${resolution.reason}`); continue; }
    lines.push(`  backend: ${resolution.backend}; model: ${String(resolution.summary.model ?? "unknown")}`);
    for (const [name, value] of Object.entries(resolution.summary)) {
      if (["kind", "model", "backend", "price"].includes(name) || value === null) continue;
      if (name === "prompt" && typeof value === "string") {
        const excerpt = value.slice(0, 240) + (value.length > 240 ? "…" : "");
        lines.push("  prompt:", ...excerpt.split(/\r?\n/).map((line) => `    ${line}`));
      } else {
        const description = describe(value, resourceNames);
        if (description) lines.push(`  ${name}: ${description}`);
      }
    }
  }
  lines.push(`Needs: ${requests.length} (${paidNeedTotal} paid, ${localNeedTotal} local, ${rejected.length} rejected)`, `Overrides: ${plan.overrides.length}`);
  if (options.verbose) {
    lines.push(`Steps: ${plan.definition.steps.length}`);
    for (const item of plan.overrides.slice(0, options.limit)) lines.push(`  ${item.output} <- ${item.candidate}`);
    for (const item of plan.unreachable.slice(0, options.limit)) lines.push(`  unreachable: ${item.label}`);
    if (plan.overrides.length > options.limit) lines.push(`  … ${plan.overrides.length - options.limit} overrides omitted`);
    if (plan.unreachable.length > options.limit) lines.push(`  … ${plan.unreachable.length - options.limit} unreachable steps omitted`);
  }
  return { data: { schema: "dsivio-video.plan-view/1", valid, runSource: plan.definition.run,
    targetTotal: plan.definition.targets.length, targetNames: plan.definition.targets, needTotal: requests.length, requestProblemTotal: diagnosticRows.length,
    paidNeedTotal, localNeedTotal, unresolvedNeedTotal: rejected.length, unsupportedNeedTotal: rejected.filter((need) => !need.resolution.ok && need.resolution.code === "UNKNOWN_CAPABILITY").length,
    overrideTotal: plan.overrides.length, requestRows,
    endpointRows: requests.map((need) => ({ needKey: `${need.step}:${need.port}`, resolution: need.resolution.ok ? "resolved" : "rejected", ...(need.resolution.ok ? { endpointName: need.resolution.backend, priceSource: { mode: need.resolution.cost === "local" ? "local" : "unknown" } } : { code: need.resolution.code, reason: need.resolution.reason }) })),
    waitingStepTotal: waiting.length, waitingRows: waiting.map((need) => ({ step: need.step, stepLabel: need.label, waitingFor: need.waitingFor, hint: "Requests will be checked before submission; paid needs may become known after inputs are ready." })),
    readiness: { valid, capabilityTotal: new Set(requests.map((need) => need.capability)).size, diagnosticTotal: diagnosticRows.length, diagnosticRows },
    ...(options.verbose ? { stepTotal: plan.definition.steps.length, overrides: plan.overrides.slice(0, options.limit), omittedOverrides: Math.max(0, plan.overrides.length - options.limit), unreachable: plan.unreachable.slice(0, options.limit), omittedUnreachable: Math.max(0, plan.unreachable.length - options.limit) } : {}) }, lines, valid };
}
