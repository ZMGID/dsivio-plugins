export type Fit = "contain" | "cover" | "stretch";
export type Interpolation = "nearest" | "linear" | "cubic" | "area" | "lanczos";
export type RasterStep =
  | { kind: "crop"; unit: "fraction" | "pixel"; x: number; y: number; width: number; height: number }
  | { kind: "resize"; width: number; height: number; fit: Fit; interpolation: Interpolation; background?: string }
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "flip"; axis: "horizontal" | "vertical" | "both" }
  | { kind: "denoise"; method: "nlm-ycrcb"; luma: number; chroma: number; templateWindow: number; searchWindow: number; saturationRecovery: number }
  | { kind: "color"; exposureStops: number; contrast: number; saturation: number; temperature: number; tint: number; gamma: number }
  | { kind: "sharpen"; amount: number; radius: number; threshold: number }
  | { kind: "blur"; sigma: number }
  | { kind: "alpha"; mode: "preserve" | "flatten"; background?: string }
  | { kind: "encode"; format: "png" | "jpeg" | "webp"; quality?: number; background?: string };
export interface ImageProgram { orderedSteps: RasterStep[] }
export const imageProgramType = "dsivio-video/image-transform@1#Program";
