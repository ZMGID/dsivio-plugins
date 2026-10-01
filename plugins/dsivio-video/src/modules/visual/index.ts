import type { ModuleDef } from "../../core/module.ts";
import { validateAudioTrack, validateSurface, validateVisualTrack } from "../../render/validate.ts";
const visual:ModuleDef={id:"dsivio-video/visual@1",summary:"Versioned terminal visual and audio tracks and verified surface declarations.",types:{VisualTrack:{summary:"Present trees with integer sampling and exact text formats.",validate:validateVisualTrack},AudioTrack:{summary:"Sample-domain audio clips.",validate:validateAudioTrack},Surface:{summary:"Explicit extent, alpha, color and timing surface declaration.",validate:validateSurface}},surfaces:{},producers:{}};
export default visual;
