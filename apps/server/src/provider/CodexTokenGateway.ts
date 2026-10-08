// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";

const excludedHeaders = new Set([
  "authorization",
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "cookie",
]);

export async function startCodexTokenGateway(options: {
  readonly getAccessToken: () => Promise<string>;
  readonly upstream?: string;
}) {
  const origin = new URL(options.upstream ?? "https://api.openai.com");
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && origin.hostname === "127.0.0.1")
  ) {
    throw new Error("Invalid Codex API origin");
  }
  const secret = NodeCrypto.randomBytes(32).toString("hex");
  const expectedAuthorization = Buffer.from(`Bearer ${secret}`);
  const server = NodeHttp.createServer((incoming, outgoing) => {
    const authorization = Buffer.from(incoming.headers.authorization ?? "");
    if (
      authorization.length !== expectedAuthorization.length ||
      !NodeCrypto.timingSafeEqual(authorization, expectedAuthorization)
    ) {
      outgoing.writeHead(401).end();
      incoming.resume();
      return;
    }
    const target = new URL(incoming.url ?? "/", origin);
    if (
      target.origin !== origin.origin ||
      !(
        (incoming.method === "POST" && target.pathname === "/v1/responses") ||
        (incoming.method === "GET" && target.pathname === "/v1/models")
      )
    ) {
      outgoing.writeHead(404).end();
      incoming.resume();
      return;
    }
    const controller = new AbortController();
    outgoing.on("close", () => controller.abort());
    void options
      .getAccessToken()
      .then((accessToken) => {
        if (controller.signal.aborted) return;
        const headers: NodeHttp.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (!excludedHeaders.has(name)) headers[name] = value;
        }
        headers.authorization = `Bearer ${accessToken}`;
        const request = (target.protocol === "https:" ? NodeHttps : NodeHttp).request(
          target,
          {
            method: incoming.method,
            headers,
            signal: controller.signal,
          },
          (response) => {
            const responseHeaders: NodeHttp.OutgoingHttpHeaders = {};
            for (const [name, value] of Object.entries(response.headers)) {
              if (!excludedHeaders.has(name) && name !== "set-cookie")
                responseHeaders[name] = value;
            }
            outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
            response.on("error", () => outgoing.destroy());
            response.pipe(outgoing);
          },
        );
        request.on("error", () => {
          if (outgoing.headersSent) outgoing.destroy();
          else outgoing.writeHead(502).end('{"error":{"message":"Codex API connection failed"}}');
        });
        incoming.on("error", () => request.destroy());
        incoming.pipe(request);
      })
      .catch(() => {
        if (!outgoing.destroyed) {
          outgoing
            .writeHead(503, { "content-type": "application/json" })
            .end('{"error":{"message":"Could not renew the ChatGPT connection"}}');
        }
        incoming.resume();
      });
  });
  server.requestTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing Codex gateway address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    secret,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
