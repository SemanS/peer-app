// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off globalTimers:off preferSchemaOverJson:off - host-side lab fixture checks on local sockets; no servers of Peer's.
import * as NodeHttp from "node:http";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { hubProxy } from "./hubProxy.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

interface Seen {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly auth: string | undefined;
  readonly body: string;
}

/** A Hub that says what it was asked: JSON for every path, a 409 for `/conflict`, an event stream for `/stream`. */
async function upstream() {
  const seen: Seen[] = [];
  const server = NodeHttp.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    seen.push({
      method: request.method,
      url: request.url,
      auth: request.headers.authorization,
      body: Buffer.concat(chunks).toString(),
    });
    if (request.url === "/stream") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: one\n\n");
      setTimeout(() => {
        response.write("data: two\n\n");
        response.end();
      }, 30);
      return;
    }
    response.writeHead(request.url === "/conflict" ? 409 : 200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ at: request.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { url: `http://127.0.0.1:${address.port}`, seen };
}

describe("the proxy in front of a Hub", () => {
  it("passes a request through as it came, with its credential and body, and the Hub's answer back", async () => {
    const hub = await upstream();
    const proxy = await hubProxy(hub.url, async () => undefined);
    closers.push(proxy.close);
    const put = await fetch(`${proxy.url}/plans/lab`, {
      method: "PUT",
      headers: { authorization: "Bearer lab", "content-type": "application/json" },
      body: JSON.stringify({ seq: 1 }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ at: "/plans/lab" });
    const conflict = await fetch(`${proxy.url}/conflict`);
    expect(conflict.status).toBe(409);
    expect(hub.seen[0]).toEqual({
      method: "PUT",
      url: "/plans/lab",
      auth: "Bearer lab",
      body: '{"seq":1}',
    });
  });

  it("passes an event stream through as it arrives", async () => {
    const hub = await upstream();
    const proxy = await hubProxy(hub.url, async () => undefined);
    closers.push(proxy.close);
    const stream = await fetch(`${proxy.url}/stream`);
    expect(await stream.text()).toBe("data: one\n\ndata: two\n\n");
  });

  it("answers by itself what it is told to, and forwards a held request later as it was", async () => {
    const hub = await upstream();
    const held: Parameters<Parameters<typeof hubProxy>[1]>[0][] = [];
    const proxy = await hubProxy(hub.url, async (request) => {
      if (request.method !== "PUT") return undefined;
      held.push(request);
      return { status: 502, body: '{"error":"held"}' };
    });
    closers.push(proxy.close);
    const refused = await fetch(`${proxy.url}/plans/lab`, {
      method: "PUT",
      headers: { authorization: "Bearer lab" },
      body: "older",
    });
    expect(refused.status).toBe(502);
    expect(hub.seen).toEqual([]);
    const late = await proxy.forward(held[0]!);
    expect(late).toEqual({ status: 200, body: '{"at":"/plans/lab"}' });
    expect(hub.seen).toEqual([
      { method: "PUT", url: "/plans/lab", auth: "Bearer lab", body: "older" },
    ]);
  });

  it("answers 502 when the Hub cannot be reached", async () => {
    const hub = await upstream();
    const proxy = await hubProxy(hub.url, async () => undefined);
    closers.push(proxy.close);
    const gone = await hubProxy("http://127.0.0.1:1", async () => undefined);
    closers.push(gone.close);
    expect((await fetch(`${gone.url}/anything`)).status).toBe(502);
    expect((await fetch(`${proxy.url}/anything`)).status).toBe(200);
  });
});
