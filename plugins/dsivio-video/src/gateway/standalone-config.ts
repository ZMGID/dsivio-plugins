import { lstat, open, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DvError } from "../core/errors.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function windowsPrivateAcl(path: string, create = false, directory = false): Promise<void> {
  const script = `$ErrorActionPreference='Stop'; $path=$env:DV_PRIVATE_PATH; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $path; ${create ? `$acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($sid); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','${directory ? "ContainerInherit,ObjectInherit" : "None"}','None','Allow'); $acl.SetAccessRule($rule); Set-Acl -LiteralPath $path -AclObject $acl; $acl=Get-Acl -LiteralPath $path;` : ""} foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid.Value) { throw 'Storage ACL permits another identity' } }; if($acl.Owner -ne $sid.Value -and $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Storage owner is not the current user' }; Write-Output 'private'`;
  const environment: NodeJS.ProcessEnv = { DV_PRIVATE_PATH: path };
  for (const name of ["SystemRoot", "WINDIR", "PATH", "TEMP", "USERPROFILE"]) if (process.env[name]) environment[name] = process.env[name];
  try {
    const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const { stdout } = await promisify(execFile)(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: environment, timeout: 30_000, maxBuffer: 64 * 1024 });
    if (stdout.trim() !== "private") throw new Error("ACL verification failed");
  } catch { throw new DvError("GATEWAY_CONFIG_UNSAFE", "Standalone storage requires a verified current-user-only Windows ACL; fix its access rules explicitly"); }
}
export async function secureNewPrivateFile(path: string): Promise<void> {
  if (process.platform === "win32") await windowsPrivateAcl(path, true);
  await assertPrivate(path);
}

export type AdapterName = "minimax" | "gemini";
export interface ProviderConfiguration { id: string; adapter: AdapterName; baseUrl: string; apiKey: string; enabledModels: string[] }
export const standaloneModelIds = { minimax: ["image-01", "MiniMax-H3", "speech-2.8-hd"], gemini: ["gemini-3.1-flash-image", "veo-3.1-generate-preview", "gemini-3.8-flash-tts"] } as const;
export function gatewayHome(): string { return join(homedir(), ".dsivio-video"); }
export async function assertPrivate(path: string, directory = false): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new DvError("GATEWAY_CONFIG_UNSAFE", `${path} must be a regular ${directory ? "directory" : "file"}, not a symlink`);
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new DvError("GATEWAY_CONFIG_UNSAFE", `${path} is accessible by other users; explicitly set permissions to ${directory ? "0700" : "0600"}`);
  if (process.platform === "win32") await windowsPrivateAcl(path);
}
export async function privateDirectory(path: string): Promise<void> {
  let existed = true;
  try { await lstat(path); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; existed = false; }
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!existed && process.platform === "win32") await windowsPrivateAcl(path, true, true);
  await assertPrivate(path, true);
}
const origins: Record<AdapterName, string[]> = { minimax: ["https://api.minimax.io"], gemini: ["https://generativelanguage.googleapis.com/v1beta"] };
export async function readStandaloneConfiguration(root = gatewayHome(), environment: NodeJS.ProcessEnv = process.env): Promise<ProviderConfiguration[]> {
  const path = join(root, "gateway.json");
  let raw: unknown;
  try {
    await assertPrivate(root, true); await assertPrivate(path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat(); if (info.size > 1024 * 1024) throw new DvError("GATEWAY_CONFIG_INVALID", "gateway.json exceeds 1 MiB");
      const text = await file.readFile("utf8");
      try { raw = JSON.parse(text); } catch { throw new DvError("GATEWAY_CONFIG_INVALID", "gateway.json is not valid JSON; credentials and source text are omitted"); }
    } finally { await file.close(); }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    raw = { schemaVersion: 1, providers: [
      ...(environment.MINIMAX_API_KEY ? [{ id: "minimax", adapter: "minimax", baseUrl: origins.minimax[0], apiKeyEnv: "MINIMAX_API_KEY", enabledModels: standaloneModelIds.minimax }] : []),
      ...(environment.GEMINI_API_KEY ? [{ id: "google", adapter: "gemini", baseUrl: origins.gemini[0], apiKeyEnv: "GEMINI_API_KEY", enabledModels: standaloneModelIds.gemini }] : []),
    ] };
    for (const name of ["MINIMAX_API_KEY", "GEMINI_API_KEY"]) if (environment[name] !== undefined && !environment[name]?.trim()) throw new DvError("GATEWAY_CREDENTIAL_MISSING", `${name} exists but is empty`);
  }
  if (!raw || typeof raw !== "object" || !("schemaVersion" in raw) || raw.schemaVersion !== 1 || !("providers" in raw) || !Array.isArray(raw.providers) || Object.keys(raw).some(k => !["schemaVersion", "providers"].includes(k))) throw new DvError("GATEWAY_CONFIG_INVALID", "Expected gateway.json schemaVersion 1 and providers array");
  const seen = new Set<string>();
  return raw.providers.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new DvError("GATEWAY_CONFIG_INVALID", "Invalid provider connection");
    const p = entry as Record<string, unknown>;
    if (Object.keys(p).some(k => !["id", "adapter", "baseUrl", "apiKeyEnv", "apiKey", "enabledModels"].includes(k)) || typeof p.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(p.id) || seen.has(p.id) || (p.adapter !== "minimax" && p.adapter !== "gemini")) throw new DvError("GATEWAY_CONFIG_INVALID", "Provider requires a unique connection id and supported adapter");
    seen.add(p.id);
    const adapter = p.adapter;
    if (typeof p.baseUrl !== "string" || !origins[p.adapter].includes(p.baseUrl.replace(/\/$/, ""))) throw new DvError("GATEWAY_ORIGIN_UNSUPPORTED", "Provider baseUrl must be an explicitly supported official HTTPS endpoint");
    if (!Array.isArray(p.enabledModels) || p.enabledModels.some(m => typeof m !== "string" || !(standaloneModelIds[adapter] as readonly string[]).includes(m)) || new Set(p.enabledModels).size !== p.enabledModels.length) throw new DvError("GATEWAY_MODEL_UNSUPPORTED", "enabledModels must contain explicit implemented model ids; models are never substituted");
    if (p.apiKeyEnv !== undefined && (typeof p.apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.apiKeyEnv))) throw new DvError("GATEWAY_CONFIG_INVALID", "Invalid apiKeyEnv name");
    const name = p.apiKeyEnv as string | undefined;
    const key = name !== undefined && environment[name] !== undefined ? environment[name] : p.apiKey;
    if (typeof key !== "string" || !key.trim()) throw new DvError("GATEWAY_CREDENTIAL_MISSING", `Connection ${p.id} requires non-empty ${name ?? "apiKey"}; an empty configured environment variable never falls back`);
    return { id: p.id, adapter: p.adapter, baseUrl: p.baseUrl.replace(/\/$/, ""), apiKey: key, enabledModels: p.enabledModels as string[] };
  });
}
