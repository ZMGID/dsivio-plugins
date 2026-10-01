// The trusted set of built-in modules and capabilities. Adding a module means adding it here.

import type { CapabilityDef } from "../core/capability.ts";
import type { FrontendDef, ModuleDef, ProducerDef } from "../core/module.ts";
import { gatewayCapabilities } from "../gateway/index.ts";
import gen from "./gen/index.ts";
import media from "./media/index.ts";
import recipe from "./recipe/index.ts";
import text from "./text/index.ts";
import script from "./script/index.ts";
import program from "./program/index.ts";
import time from "./time/index.ts";
import pipeline from "./pipeline/index.ts";
import align from "./align/index.ts";
import space from "./space/index.ts";
import fonts from "./fonts/index.ts";
import typo from "./typo/index.ts";
import sound from "./sound/index.ts";
import performance from "./performance/index.ts";
import film from "./film/index.ts";
import visual from "./visual/index.ts";
import render from "./render/index.ts";
import { localCapabilities as pipelineCapabilities } from "../pipeline/capabilities.ts";
import { localCapabilities as fontCapabilities } from "../fonts/capabilities.ts";
import { localCapabilities as renderCapabilities } from "../render/capabilities.ts";

export const modules: readonly ModuleDef[] = [text, recipe, media, gen, script, program, time, pipeline, align, space, fonts, typo, sound, performance, visual, film, render];
export const capabilities: readonly CapabilityDef[] = [...gatewayCapabilities, ...pipelineCapabilities, ...fontCapabilities, ...renderCapabilities];

export function findModule(id: string): ModuleDef | undefined {
  return modules.find((module) => module.id === id);
}

// Registry tables are plain objects: only own keys count, so `constructor` or `__proto__` never resolve.

/** `ref` is `${moduleId}#${producerName}`. */
export function findProducer(ref: string): ProducerDef | undefined {
  const hash = ref.lastIndexOf("#");
  if (hash < 0) return undefined;
  const producers = findModule(ref.slice(0, hash))?.producers;
  const name = ref.slice(hash + 1);
  return producers && Object.hasOwn(producers, name) ? producers[name] : undefined;
}

export function findCapability(name: string): CapabilityDef | undefined {
  return capabilities.find((capability) => capability.name === name);
}

/** The `.dvs` reader registered for a header `using` address. */
export function findFrontend(using: string): FrontendDef | undefined {
  for (const module of modules) {
    if (module.frontends && Object.hasOwn(module.frontends, using)) return module.frontends[using];
  }
  return undefined;
}
