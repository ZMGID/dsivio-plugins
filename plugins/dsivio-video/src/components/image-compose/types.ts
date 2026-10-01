import type { Fit, Interpolation } from "../image-transform/types.ts";
export interface LayerOptions { fit: Fit; interpolation: Interpolation; opacity: number }
export interface ComposePlan { background: string; layers: LayerOptions[] }
export const composePlanType = "dsivio-video/image-compose@1#Plan";
