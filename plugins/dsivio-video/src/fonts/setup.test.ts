import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execute=promisify(execFile);
test("font preparation creates a fresh home root before downloads and cleans failed staging",async t=>{
 const home=await mkdtemp(join(tmpdir(),"dv-fresh-fonts-"));t.after(()=>rm(home,{recursive:true,force:true}));
 const source=`
  import assert from 'node:assert/strict';
  import {stat,readdir} from 'node:fs/promises';
  import {dirname} from 'node:path';
  globalThis.fetch=async()=>{throw new Error('Network intentionally unavailable');};
  import {setupFonts} from ${JSON.stringify(new URL("./setup.ts",import.meta.url).href)};
  import {fontDirectory} from ${JSON.stringify(new URL("./catalog.ts",import.meta.url).href)};
  await assert.rejects(setupFonts(),{code:'FONT_SETUP_FAILED'});
  assert.equal((await stat(dirname(fontDirectory))).isDirectory(),true);
  assert.deepEqual(await readdir(dirname(fontDirectory)),[]);
 `;
 await execute(process.execPath,["--input-type=module","-e",source],{env:{...process.env,HOME:home,USERPROFILE:home}});
});
