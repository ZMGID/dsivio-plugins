import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ProviderFailure } from "./types.ts";
import type { ProviderConnection } from "./types.ts";
import type { Json } from "../../core/value.ts";
import { wireObject } from "./description.ts";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { LookupAddress } from "node:dns";

const pinnedAddresses = new WeakMap<URL, LookupAddress>();

export function redactProviderError(message: string, key?: string): string {
  let text = message.replace(/https?:\/\/[^\s"'<>]+/g, "[redacted URL]").replace(/(authorization|api[-_ ]?key|x-goog-api-key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
  if (key) text = text.split(key).join("[redacted]");
  return text.slice(0, 2000);
}
export async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) { await response.body?.cancel(); throw new ProviderFailure("GATEWAY_RESPONSE_TOO_LARGE", "Provider response exceeds the byte limit", "uncertain"); }
  if (!response.body) throw new ProviderFailure("GATEWAY_RESPONSE_INVALID", "Provider returned no body", "uncertain");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > limit) throw new ProviderFailure("GATEWAY_RESPONSE_TOO_LARGE", "Provider response exceeds the byte limit", "uncertain"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, total);
}
export async function providerJson(connection: ProviderConnection, adapter: "minimax" | "gemini", path: string, body?: unknown): Promise<Record<string, Json>> {
  const submitting = body !== undefined;
  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl}${path}`, { method: submitting ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(submitting ? 600_000 : 60_000), headers: { ...(adapter === "minimax" ? { Authorization: `Bearer ${connection.apiKey}` } : { "x-goog-api-key": connection.apiKey }), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, ...(submitting ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
  } catch { throw new ProviderFailure("GATEWAY_TRANSPORT_FAILED", "Provider connection failed; a submitted operation may have been accepted, never resubmit", submitting ? "uncertain" : "query"); }
  const retry = response.headers.get("retry-after"); const delay = retry ? /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now() : NaN;
  const retryAfterMs = Number.isFinite(delay) ? Math.max(10_000, delay) : undefined;
  let parsed: Record<string, Json>;
  try { parsed = wireObject(JSON.parse((await boundedBody(response, submitting ? 192 * 1024 * 1024 : 4 * 1024 * 1024)).toString("utf8"))); }
  catch { throw new ProviderFailure("GATEWAY_RESPONSE_INVALID", `Provider returned invalid JSON (HTTP ${response.status}); preserve the submission for manual verification`, submitting ? "uncertain" : "query", retryAfterMs); }
  const business = parsed.base_resp && typeof parsed.base_resp === "object" && !Array.isArray(parsed.base_resp) ? parsed.base_resp : {};
  const vendorError = parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error) ? parsed.error : {};
  if (!response.ok) {
    const definitelyRejected = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status) && (parsed.error !== undefined || business.status_code !== undefined);
    throw new ProviderFailure(`PROVIDER_HTTP_${response.status}`, redactProviderError(`HTTP ${response.status}: ${vendorError.message ?? business.status_msg ?? "provider rejected the request"}`, connection.apiKey), submitting ? definitelyRejected ? "rejected" : "uncertain" : "query", retryAfterMs);
  }
  if (adapter === "minimax") {
    const status = business.status_code;
    if (status !== undefined && status !== 0) throw new ProviderFailure(`MINIMAX_${status}`, redactProviderError(String(business.status_msg ?? "MiniMax business error"), connection.apiKey), submitting ? typeof status === "number" && [1004, 1008, 1026, 2013, 2049, 1043].includes(status) ? "rejected" : "uncertain" : "query", retryAfterMs);
    if (path.startsWith("/v1/") && status !== 0) throw new ProviderFailure("GATEWAY_RESPONSE_INVALID", "MiniMax response did not confirm business acceptance", submitting ? "uncertain" : "query");
  }
  return parsed;
}
export async function publicHttpsUrl(value: string): Promise<URL> {
  let url: URL; try { url = new URL(value); } catch { throw new ProviderFailure("GATEWAY_URL_INVALID", "Provider artifact URL is invalid", "query"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || ["key", "api_key", "apiKey", "access_token", "x-goog-api-key"].some(name => url.searchParams.has(name))) throw new ProviderFailure("GATEWAY_URL_INVALID", "Artifact URLs require HTTPS without embedded credentials, API keys or non-standard ports", "query");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses: LookupAddress[] = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  for (const { address } of addresses) {
    const lower = address.toLowerCase();
    if (lower.includes(":") ? !/^[23][0-9a-f]{3}:/.test(lower) || lower.startsWith("2001:db8:") : /^(0\.|10\.|127\.|169\.254\.|192\.168\.|192\.0\.|198\.(1[89]|51)\.|203\.0\.113\.|100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(lower)) throw new ProviderFailure("GATEWAY_URL_PRIVATE", "Provider artifact URL resolves to a non-public address", "query");
  }
  if (!addresses[0]) throw new ProviderFailure("GATEWAY_URL_INVALID", "Artifact hostname has no public address", "query");
  pinnedAddresses.set(url, addresses[0]);
  return url;
}
export async function downloadArtifact(connection: ProviderConnection, adapter: "minimax" | "gemini", source: string, expectedKind: "image" | "video" | "audio", limit = 512 * 1024 * 1024): Promise<{ bytes: Buffer; mime: string }> {
  let url = await publicHttpsUrl(source); const origin = new URL(connection.baseUrl).origin;
  for (let hop = 0; hop <= 5; hop++) {
    const address = pinnedAddresses.get(url);
    if (!address) throw new ProviderFailure("GATEWAY_URL_INVALID", "Artifact address was not validated", "query");
    const result = Promise.withResolvers<Response>();
    const request = httpsRequest(url, {
      method: "GET", family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: url.origin === origin ? adapter === "minimax" ? { Authorization: `Bearer ${connection.apiKey}` } : { "x-goog-api-key": connection.apiKey } : {},
    }, incoming => {
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        // Pin the previously verified public IP; the TLS server name remains the URL hostname.
        const status = incoming.statusCode ?? 502;
        result.resolve(new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers }));
        if ([204, 205, 304].includes(status)) incoming.resume();
      } catch {
        incoming.destroy(); result.reject(new ProviderFailure("GATEWAY_DOWNLOAD_FAILED", "Artifact response is invalid; saved receipt retained", "query"));
      }
    });
    const deadline = setTimeout(() => request.destroy(new Error("Artifact download deadline exceeded")), 120_000);
    request.on("error", () => result.reject(new ProviderFailure("GATEWAY_DOWNLOAD_FAILED", "Artifact transport failed; saved receipt retained", "query")));
    request.on("close", () => clearTimeout(deadline));
    request.end();
    const response = await result.promise;
    if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); const location = response.headers.get("location"); if (!location || hop === 5) throw new ProviderFailure("GATEWAY_DOWNLOAD_REDIRECT", "Artifact redirect limit exceeded", "query"); url = await publicHttpsUrl(new URL(location, url).href); continue; }
    if (!response.ok) { await response.body?.cancel(); throw new ProviderFailure("GATEWAY_DOWNLOAD_FAILED", `Artifact download failed (HTTP ${response.status}); saved receipt is retained`, "query"); }
    const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase();
    if (!mime.startsWith(`${expectedKind}/`)) { await response.body?.cancel(); throw new ProviderFailure("GATEWAY_MIME_INVALID", "Artifact Content-Type does not match the requested media kind", "query"); }
    return { bytes: await boundedBody(response, limit), mime };
  }
  throw new ProviderFailure("GATEWAY_DOWNLOAD_FAILED", "Artifact was not downloaded", "query");
}
