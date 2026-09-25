import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Static server for the fixture company sites, shaped like the grader's setup
 * (several companies under one host: http://localhost:8099/acme/, /globex/...).
 * Used by the retrieval tests and for local runs of the batch CLI.
 */
const ROOT = path.resolve(import.meta.dirname, "sites");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
};

export function startFixtureServer(port = 0): Promise<{ url: string; server: Server; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://fixture");
    const filePath = path.resolve(ROOT, `.${decodeURIComponent(reqUrl.pathname)}`);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      let target = filePath;
      if ((await stat(target)).isDirectory()) {
        if (!reqUrl.pathname.endsWith("/")) {
          res.writeHead(301, { location: `${reqUrl.pathname}/` }).end();
          return;
        }
        target = path.join(target, "index.html");
      }
      let body = await readFile(target);
      const type = TYPES[path.extname(target)] ?? "application/octet-stream";
      if (type === "application/xml") body = Buffer.from(body.toString().replaceAll("HOST", req.headers.host ?? ""));
      res.writeHead(200, { "content-type": type }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://localhost:${actualPort}`,
        server,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
