import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import type { UiCommand } from "./contract";
import type { UiSession } from "./session";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const json = (res: ServerResponse, code: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(payload);
};

export interface ServerOptions {
  readonly port: number;
  readonly webDir: string;
  readonly session: UiSession;
}

export function startServer(opts: ServerOptions): void {
  const server = createServer((req, res) => handle(req, res, opts));
  server.listen(opts.port, () => {
    process.stdout.write(`\n  HELM UI  →  http://localhost:${opts.port}\n`);
    process.stdout.write(`  state    →  http://localhost:${opts.port}/api/state\n`);
    process.stdout.write(`  events   →  http://localhost:${opts.port}/api/events (SSE)\n\n`);
  });
}

function handle(req: IncomingMessage, res: ServerResponse, opts: ServerOptions): void {
  const url = (req.url ?? "/").split("?")[0] ?? "/";
  const method = req.method ?? "GET";

  if (url === "/api/state" && method === "GET") {
    json(res, 200, opts.session.snapshot());
    return;
  }

  if (url === "/api/events" && method === "GET") {
    serveEvents(req, res, opts.session);
    return;
  }

  if (url === "/api/command" && method === "POST") {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      try {
        const cmd = JSON.parse(body) as UiCommand;
        json(res, 200, opts.session.command(cmd));
      } catch {
        json(res, 400, { ok: false, error: "invalid command JSON" });
      }
    });
    return;
  }

  if (method !== "GET") {
    json(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  serveStatic(res, opts.webDir, url);
}

function serveEvents(req: IncomingMessage, res: ServerResponse, session: UiSession): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(": connected\n\n");
  const unsubscribe = session.subscribe((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
  const heartbeat = setInterval(() => res.write(": hb\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function serveStatic(res: ServerResponse, webDir: string, urlPath: string): void {
  const rel = urlPath === "/" ? "/HELM.html" : decodeURIComponent(urlPath);
  const full = normalize(join(webDir, rel));
  if (full !== webDir && !full.startsWith(webDir + sep)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream" });
  createReadStream(full).pipe(res);
}
