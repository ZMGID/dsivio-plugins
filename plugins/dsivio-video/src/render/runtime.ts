/// <reference lib="dom" />
import { textRuntimeSource } from "./text-runtime.ts";
import type { Bounds, Clock } from "../timeline/types.ts";
import type { ProgramDomain, VisualNode } from "./ir.ts";
export interface BrowserNode { id: string; node: VisualNode }
export interface BrowserPresent { id: string; lifetime: Bounds; visible?: Bounds[]; nodes: BrowserNode[] }
export interface BrowserWindow {
  __dvRange?: Bounds;
  __dvDocument: Pick<ProgramDomain,"clock"|"totalFrames"> & { presents: BrowserPresent[] };
  __dvText: { mount(root: Element, node: unknown, lifetime: number, clock: Clock): Promise<{ seek(frame: number): void }> };
  __dvReady: Promise<void>;
  __dvSeekError: unknown;
  __dvSeekFrame(frame: number): void;
  __hf: { duration: number; seek(seconds: number): void };
  __dvMaskState: { element: HTMLElement; style: string | null }[];
}
/** Runtime state is derived from original integer program frames on every seek. */
export function runtimeSource(): string {
  return `${textRuntimeSource()}\n(${pageRuntime.toString()})();`;
}
function pageRuntime() {
  const win = window as unknown as BrowserWindow;
  const data = win.__dvDocument; const drawers: {draw:(frame:number)=>void;start:number;duration:number}[] = []; const animations:{animation:Animation;start:number;duration:number}[]=[];
  win.__dvReady = (async () => {
    for (const present of data.presents) {
      const duration = present.lifetime.end-present.lifetime.start;
      for (const entry of present.nodes) {
        const root = document.getElementById(entry.id)!; const node = entry.node;
        if(node.kind==="program"&&win.__dvRange&&(present.lifetime.end<=win.__dvRange.start||present.lifetime.start>=win.__dvRange.end))continue;
        if (["text","text-flow","path-text"].includes(String(node.kind))) { const mounted=await win.__dvText.mount(root,node,duration,data.clock); drawers.push({draw:mounted.seek,start:present.lifetime.start,duration}); }
        if (node.kind === "program") { const program = node.program; if (program.setup) { const draw = new Function("root","data",program.setup)(root,program.data); if (typeof draw !== "function") throw new Error("Program setup must return a synchronous draw function"); drawers.push({draw,start:present.lifetime.start,duration}); } }
        const keys=node.keyframes;
        if (keys.length) { const span=Math.max(duration,keys[keys.length-1]!.offsetFrames); const keyframes=keys.map(k=>{const pose:Record<string,string|number>={offset:k.offsetFrames/span,easing:k.easing};for(const d of k.declarations)pose[d.property]=d.value;return pose;}); if(keys[keys.length-1]!.offsetFrames<span)keyframes.push({...keyframes[keyframes.length-1],offset:1}); const animation=root.animate(keyframes,{duration:span*1000*data.clock.fps.denominator/data.clock.fps.numerator,fill:"both"});animation.pause();animations.push({animation,start:present.lifetime.start,duration:span}); }
      }
    }
    await document.fonts.ready;
    for(const image of Array.from(document.images))if(image.src)await image.decode();
    win.__dvSeekFrame(0);
  })();
  win.__dvSeekFrame=(frame:number)=>{
    try {
      if(!Number.isSafeInteger(frame)||frame<0||frame>=data.totalFrames)throw new Error("Seek outside integer program frame domain");
      for(const p of data.presents){const active=frame>=p.lifetime.start&&frame<p.lifetime.end&&(p.visible===undefined||p.visible.some(w=>frame>=w.start&&frame<w.end));document.getElementById(p.id)!.style.visibility=active?"visible":"hidden";}
      for(const a of animations)a.animation.currentTime=Math.min(a.duration,Math.max(0,frame-a.start))*1000*data.clock.fps.denominator/data.clock.fps.numerator;
      for(const d of drawers){const result:unknown=d.draw(Math.min(d.duration,Math.max(0,frame-d.start)));if(result&&typeof result==="object"&&"then" in result&&typeof result.then==="function")throw new Error("Program draw must be synchronous");}
      win.__dvSeekError=null;
    }catch(error){win.__dvSeekError=error instanceof Error?error.message:String(error);throw error;}
  };
  win.__hf={duration:data.totalFrames*data.clock.fps.denominator/data.clock.fps.numerator,seek(seconds:number){const f=Math.round(seconds*data.clock.fps.numerator/data.clock.fps.denominator);win.__dvSeekFrame(f);}};
}
