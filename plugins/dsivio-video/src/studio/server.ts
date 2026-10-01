import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DvError } from "../core/errors.ts";
import type { Json } from "../core/value.ts";
import { assertStudioRequest, createStudioToken } from "./security.ts";
import { StudioSession, studioError } from "./session.ts";
import { FeedbackStore } from "./feedback.ts";
import { StudioLibraries } from "./libraries.ts";
import { applyFieldEdit } from "./edits.ts";
import { applyTimeEdit } from "./temporal-edits.ts";
import type { FieldEditRequest, RenameArtifactRequest, SourceEditRequest, TimeEditRequest } from "./protocol.ts";

const staticNames = ["main.js", "api.js", "state.js", "shell.js", "source.js", "stage.js", "transport.js", "audio.js", "materials.js", "preview-shim.js", "timeline.js", "inspector.js", "fields.js", "menus.js", "comments.js", "tasks.js", "artifacts.js", "locale.js", "studio.css", "locales/en.json", "locales/zh-CN.json"];
const staticFiles = new Map(staticNames.map(name => [`/ui/${name}`, fileURLToPath(new URL(`./ui/${name}`, import.meta.url))]));
for (const name of ["preact/preact.module.js", "preact/hooks.module.js", "htm/htm.module.js"]) staticFiles.set(`/vendor/${name}`, fileURLToPath(new URL(`../../studio/vendor/${name}`, import.meta.url)));
const statusByCode: Record<string, number> = {
  STUDIO_EDIT_STALE: 409, STUDIO_TIME_AMBIGUOUS: 409, STUDIO_FIELD_AMBIGUOUS: 409, STUDIO_SOURCE_AMBIGUOUS: 409,
  STUDIO_ENTITY_MISSING: 404, STUDIO_FIELD_MISSING: 404, STUDIO_ENDPOINT_MISSING: 404, STUDIO_TIME_ENDPOINT_MISSING: 404, STUDIO_SOURCE_MISSING: 404,
  STUDIO_FIELD_VALUE: 400, STUDIO_PATCH_RANGE: 400, STUDIO_TIME_WINDOW: 400, STUDIO_TIME_OUTSIDE: 400,
  STUDIO_FIELD_READONLY: 403, STUDIO_TIME_READONLY: 403, STUDIO_SOURCE_READONLY: 403,
  OUTPUT_MISSING: 404,
};
function errorStatus(error: DvError): number {
  if (Object.hasOwn(statusByCode, error.code)) return statusByCode[error.code]!;
  if (error.code === "STUDIO_COMPILE_FAILED") return 500;
  if (error.code === "STUDIO_EDIT_INVALID") return 422;
  if (error.code.includes("FORBIDDEN")) return 403;
  if (error.code.includes("NOT_FOUND")) return 404;
  if (error.code.includes("CONFLICT") || error.code === "STUDIO_NOT_READY") return 409;
  if (error.code.includes("INVALID") || error.code.includes("REQUEST") || error.code.includes("QUERY")) return 400;
  return 500;
}
function json(response: ServerResponse, value: unknown, revision: number, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Studio-Revision": String(revision), "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}
async function payload(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += data.length; if (bytes > 8 * 1024 * 1024) throw new DvError("STUDIO_REQUEST_INVALID", "JSON body exceeds 8 MiB"); chunks.push(data); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (cause) { throw new DvError("STUDIO_REQUEST_INVALID", "Invalid JSON body", { cause }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DvError("STUDIO_REQUEST_INVALID", "JSON body must be an object");
  return value as Record<string, unknown>;
}
function version(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.expectedViewRevision) || Number(body.expectedViewRevision) < 0) throw new DvError("STUDIO_REQUEST_INVALID", "expectedViewRevision must be a non-negative integer");
  return Number(body.expectedViewRevision);
}
function text(body: Record<string, unknown>, name: string): string {
  const value = body[name]; if (typeof value !== "string" || !value.trim()) throw new DvError("STUDIO_REQUEST_INVALID", `${name} must be non-empty text`); return value;
}
function limit(url: URL): number | undefined {
  const value = url.searchParams.get("limit"); if (value === null) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 100) throw new DvError("STUDIO_QUERY_INVALID", "limit must be 1..100"); return Number(value);
}
function html(session: StudioSession, preview: boolean): string {
  const view = session.currentView();
  let result = view.document.html.replace(/dv-resource:\/\/([^\s"'<>\),]+)/g, (_match, encoded: string) => {
    const id = decodeURIComponent(encoded); session.material(id); return `/__studio/material/${encodeURIComponent(id)}`;
  }).replace(/data-dv-src=/g, "src=");
  if (preview) result = result.replace("</body>", '<script src="/ui/preview-shim.js"></script></body>');
  return result;
}
export interface StudioServer { server: Server; session: StudioSession; port: number; url: string; close(): Promise<void> }
export async function startStudioServer(session: StudioSession, requestedPort = 5179): Promise<StudioServer> {
  if (!Number.isSafeInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) throw new DvError("STUDIO_PORT_INVALID", "Studio port must be 1..65535");
  const token = createStudioToken();
  const feedback = new FeedbackStore(session.workspace.root, session.runFile);
  const libraries = new StudioLibraries(session.workspace);
  const clients = new Set<ServerResponse>();
  const pending = new Map<ServerResponse, string>();
  const writeEvent = (response: ServerResponse, event: string): void => {
    if (response.destroyed) return;
    if (response.writableNeedDrain) pending.set(response, event);
    else response.write(event);
  };
  let port = requestedPort; let eventId = 0;
  const send = (name: string): void => {
    const data = JSON.stringify({ sessionId: session.sessionId, viewRevision: session.state.requestedRevision, state: session.state });
    const event = `id: ${++eventId}\nevent: ${name}\ndata: ${data}\n\n`;
    for (const response of clients) writeEvent(response, event);
  };
  for (const name of ["compiling", "view", "compile-error"]) session.on(name, () => send(name));
  const commentsChanged = async (): Promise<void> => {
    try {
      const comments = await feedback.list("all");
      const event = `id: ${++eventId}\nevent: comments-changed\ndata: ${JSON.stringify({ sessionId: session.sessionId, commentsRevision: comments.commentsRevision })}\n\n`;
      for (const response of clients) writeEvent(response, event);
    } catch (error) { const failure = studioError(error); const event = `id: ${++eventId}\nevent: comments-changed\ndata: ${JSON.stringify({ sessionId: session.sessionId, error: { code: failure.code, message: failure.message } })}\n\n`; for (const response of clients) writeEvent(response, event); }
  };
  session.on("comments-changed", () => { void commentsChanged(); });
  const server = createServer((request, response) => {
    void (async () => {
      try {
        assertStudioRequest(request, port, token);
        const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
        const path = url.pathname;
        const method = request.method ?? "GET";
        if (method === "GET" && path === "/__studio/health") { json(response, { sessionId: session.sessionId, runFile: session.runFile }, session.state.requestedRevision); return; }
        if (method === "GET" && path === "/__studio/bootstrap") { json(response, { protocol: "dsivio-video.studio/1", sessionId: session.sessionId, token, locale: "en", state: session.state }, session.state.requestedRevision); return; }
        if (method === "GET" && path === "/__studio/view") { json(response, session.state, session.state.requestedRevision); return; }
        if (method === "GET" && path === "/__studio/events") {
          response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Studio-Revision": String(session.state.requestedRevision) });
          clients.add(response); const name = session.state.status === "ready" ? "view" : session.state.status === "error" ? "compile-error" : "compiling";
          response.write(`id: ${++eventId}\nevent: ${name}\ndata: ${JSON.stringify({ sessionId: session.sessionId, viewRevision: session.state.requestedRevision, state: session.state })}\n\n`);
          response.on("drain", () => { const latest = pending.get(response); if (latest) { pending.delete(response); writeEvent(response, latest); } });
          const heartbeat = setInterval(() => { if (!response.destroyed && !response.writableNeedDrain) response.write(": heartbeat\n\n"); }, 15_000);
          response.on("close", () => { clearInterval(heartbeat); clients.delete(response); pending.delete(response); }); return;
        }
        if (method === "GET" && path === "/__studio/document") { json(response, session.currentView().document, session.state.publishedRevision); return; }
        if (method === "GET" && (path === "/__studio/html" || path === "/__studio/preview")) {
          const view = session.currentView();
          if (path.endsWith("preview") && Number(url.searchParams.get("revision")) !== view.viewRevision) throw new DvError("STUDIO_CONFLICT", "Preview revision is stale");
          // BrowserProgram setup is trusted built-in renderer code; only this token-free iframe allows its Function constructor.
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Studio-Revision": String(view.viewRevision), "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox allow-scripts; default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" }); response.end(html(session, path.endsWith("preview"))); return;
        }
        if (method === "GET" && path.startsWith("/__studio/material/")) {
          const material = session.material(decodeURIComponent(path.slice("/__studio/material/".length)));
          const info = await stat(material.path); if (!info.isFile() || info.size !== material.ref.bytes) throw new DvError("STUDIO_MATERIAL_INVALID", "Material bytes no longer match declaration");
          let start = 0; let end = material.ref.bytes - 1; let status = 200;
          const range = request.headers.range;
          if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match || (!match[1] && !match[2])) { response.writeHead(416, { "Content-Range": `bytes */${material.ref.bytes}` }); response.end(); return; }
            if (!match[1]) start = Math.max(0, material.ref.bytes - Number(match[2]));
            else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= material.ref.bytes) { response.writeHead(416, { "Content-Range": `bytes */${material.ref.bytes}` }); response.end(); return; }
            status = 206;
          }
          response.writeHead(status, { "Content-Type": material.ref.mime, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${material.ref.bytes}` } : {}), ...(request.headers.origin === "null" ? { "Access-Control-Allow-Origin": "null" } : {}), "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "X-Studio-Revision": String(session.state.publishedRevision) });
          const stream = createReadStream(material.path, { start, end }); stream.on("error", error => response.destroy(studioError(error))); stream.pipe(response); return;
        }
        if (method === "GET" && path === "/__studio/source") { json(response, session.source(url.searchParams.get("unit") ?? ""), session.state.requestedRevision); return; }
        if (method === "PUT" && path === "/__studio/source") {
          const body = await payload(request); if (typeof body.text !== "string") throw new DvError("STUDIO_REQUEST_INVALID", "text must be a string");
          const edit: SourceEditRequest = { unit: text(body, "unit"), text: body.text, expectedSourceVersion: text(body, "expectedSourceVersion"), expectedViewRevision: version(body) };
          await session.saveSource(edit); json(response, session.source(edit.unit), session.state.requestedRevision); return;
        }
        if (method === "POST" && path === "/__studio/fields") {
          const body = await payload(request); if (!("value" in body)) throw new DvError("STUDIO_REQUEST_INVALID", "value is required");
          const edit: FieldEditRequest = { expectedViewRevision: version(body), editorKey: text(body, "editorKey"), fieldKey: text(body, "fieldKey"), value: body.value as Json };
          json(response, await applyFieldEdit(session, edit), session.state.requestedRevision); return;
        }
        if (method === "POST" && path === "/__studio/time") {
          const body = await payload(request); const gesture = text(body, "gesture");
          if (gesture !== "move" && gesture !== "trim-start" && gesture !== "trim-end" && gesture !== "reanchor") throw new DvError("STUDIO_REQUEST_INVALID", "Unknown time gesture");
          const edit: TimeEditRequest = { expectedViewRevision: version(body), editorKey: text(body, "editorKey"), authorityKey: text(body, "authorityKey"), gesture };
          for (const key of ["targetFrame", "deltaFrames"] as const) if (body[key] !== undefined) { if (!Number.isSafeInteger(body[key])) throw new DvError("STUDIO_REQUEST_INVALID", `${key} must be integer`); edit[key] = Number(body[key]); }
          if (body.anchorKey !== undefined) edit.anchorKey = text(body, "anchorKey");
          json(response, await applyTimeEdit(session, edit), session.state.requestedRevision); return;
        }
        if (method === "GET" && path === "/__studio/comments") { json(response, await feedback.list("all"), session.state.requestedRevision); return; }
        if (method === "POST" && path === "/__studio/comments") { const body = await payload(request); json(response, await feedback.add(body.comment), session.state.requestedRevision); await commentsChanged(); return; }
        if ((method === "PUT" || method === "DELETE") && path.startsWith("/__studio/comments/")) { const body = await payload(request); const id = decodeURIComponent(path.slice("/__studio/comments/".length)); json(response, method === "PUT" ? await feedback.update(id, body.expectedComment, body.changes) : await feedback.delete(id, body.expectedComment), session.state.requestedRevision); await commentsChanged(); return; }
        if (method === "GET" && path === "/__studio/tasks") { const state = url.searchParams.get("state") ?? "all"; if (state !== "all" && state !== "active" && state !== "ended") throw new DvError("STUDIO_QUERY_INVALID", "Unknown task state"); json(response, await libraries.tasks({ state, before: url.searchParams.get("before") ?? undefined, limit: limit(url) }), session.state.requestedRevision); return; }
        if (method === "GET" && path === "/__studio/artifacts") { const kind = url.searchParams.get("kind") ?? "all"; if (kind !== "all" && kind !== "image" && kind !== "video" && kind !== "audio") throw new DvError("STUDIO_QUERY_INVALID", "Unknown artifact kind"); const page = await libraries.artifacts({ kind, build: url.searchParams.get("build") ?? undefined, before: url.searchParams.get("before") ?? undefined, limit: limit(url) }); for (const artifact of page.artifacts) session.registerResource(artifact.resource); json(response, page, session.state.requestedRevision); return; }
        if (method === "POST" && path === "/__studio/artifacts/rename") { const body = await payload(request); const edit: RenameArtifactRequest = { build: text(body, "build"), output: text(body, "output"), expectedManifestVersion: text(body, "expectedManifestVersion"), displayName: text(body, "displayName") }; json(response, await libraries.rename(edit), session.state.requestedRevision); return; }
        if (method === "GET" && path === "/") {
          const nonce = randomBytes(16).toString("base64"); const page = (await readFile(new URL("./ui/index.html", import.meta.url), "utf8")).replaceAll("{{nonce}}", nonce);
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`, "X-Content-Type-Options": "nosniff", "X-Studio-Revision": String(session.state.requestedRevision) }); response.end(page); return;
        }
        const file = method === "GET" ? staticFiles.get(path) : undefined;
        if (file) { const bytes = await readFile(file); response.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript; charset=utf-8" : path.endsWith(".css") ? "text/css; charset=utf-8" : "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "X-Studio-Revision": String(session.state.requestedRevision) }); response.end(bytes); return; }
        throw new DvError("STUDIO_ROUTE_NOT_FOUND", "Unknown Studio route");
      } catch (error) { const failure = studioError(error); if (!response.headersSent) json(response, { code: failure.code, message: failure.message, viewRevision: session.state.requestedRevision, ...(failure.span ? { span: failure.span } : {}) }, session.state.requestedRevision, errorStatus(failure)); else response.destroy(failure); }
    })();
  });
  for (;;) {
    try { await new Promise<void>((resolve, reject) => { const failed = (error: Error): void => { server.off("listening", opened); reject(error); }; const opened = (): void => { server.off("error", failed); resolve(); }; server.once("error", failed); server.once("listening", opened); server.listen(port, "127.0.0.1"); }); break; }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE" && port < 65535) { port++; continue; } throw new DvError("STUDIO_LISTEN_FAILED", `Cannot listen on 127.0.0.1:${port}`, { cause: error }); }
  }
  await session.start();
  return { server, session, port, url: `http://127.0.0.1:${port}/`, async close() { for (const response of clients) response.end(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(new DvError("STUDIO_CLOSE_FAILED", error.message, { cause: error })) : resolve())); await session.close(); } };
}
