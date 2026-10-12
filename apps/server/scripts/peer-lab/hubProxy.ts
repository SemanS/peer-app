// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off globalConsole:off preferSchemaOverJson:off - opt-in isolated protocol lab.
import * as NodeHttp from "node:http";
import * as NodeStream from "node:stream";

/** A request as it reached the proxy. */
export interface ProxiedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: Buffer;
}

/** What the Hub said, whole. */
export interface Answered {
  readonly status: number;
  readonly body: string;
}

export interface HubProxy {
  readonly url: string;
  /** Sends a request to the Hub as it came, and says how the Hub answered. */
  readonly forward: (request: ProxiedRequest) => Promise<Answered>;
  readonly close: () => Promise<void>;
}

/**
 * A proxy in front of a Hub that passes everything through, event streams included, except the
 * requests `intercept` answers itself (it may `forward` a request to the Hub first, or hold it).
 * Only the lab process opens it; what it carries stays inside the lab's private Hub. It lives in the
 * lab's process, so it serves nothing while the lab waits on a synchronous call such as `spawnSync`:
 * a computer behind it is driven with calls that do not block (`peerAsync`), or its requests wait.
 */
export async function hubProxy(
  upstream: string,
  intercept: (
    request: ProxiedRequest,
    proxy: Pick<HubProxy, "forward">,
  ) => Promise<Answered | undefined>,
): Promise<HubProxy> {
  const send = (request: ProxiedRequest) =>
    fetch(upstream + request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body.length > 0 ? { body: request.body } : {}),
    });
  const forward: HubProxy["forward"] = async (request) => {
    const reply = await send(request);
    return { status: reply.status, body: await reply.text() };
  };
  const server = NodeHttp.createServer(async (incoming, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value !== undefined && !["host", "connection", "content-length"].includes(key))
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const request: ProxiedRequest = {
        method: incoming.method ?? "GET",
        url: incoming.url ?? "/",
        headers,
        body: Buffer.concat(chunks),
      };
      const answered = await intercept(request, { forward });
      if (answered !== undefined) {
        response.writeHead(answered.status, { "content-type": "application/json" });
        response.end(answered.body);
        return;
      }
      const reply = await send(request);
      const replied = new Headers(reply.headers);
      replied.delete("content-length");
      replied.delete("content-encoding");
      response.writeHead(reply.status, Object.fromEntries(replied));
      if (reply.body) {
        const stream = NodeStream.Readable.fromWeb(reply.body);
        stream.on("error", () => response.destroy());
        response.once("close", () => stream.destroy());
        stream.pipe(response);
      } else response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing lab proxy address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    forward,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
