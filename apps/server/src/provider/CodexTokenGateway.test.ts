// @effect-diagnostics nodeBuiltinImport:off globalFetch:off
import * as NodeHttp from "node:http";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { startCodexTokenGateway } from "./CodexTokenGateway.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function upstream(handler: NodeHttp.RequestListener) {
  const server = NodeHttp.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing address");
  return `http://127.0.0.1:${address.port}`;
}

describe("Codex token gateway", () => {
  it("delivers streamed bytes before the upstream response completes", async () => {
    const started = Promise.withResolvers<NodeHttp.ServerResponse>();
    const origin = await upstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      started.resolve(response);
    });
    const gateway = await startCodexTokenGateway({
      upstream: origin,
      getAccessToken: async () => "current-token",
    });
    cleanup.push(gateway.close);
    const response = await fetch(`${gateway.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${gateway.secret}` },
      body: "{}",
    });
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n");
    expect(first.done).toBe(false);
    (await started.promise).end();
    expect((await reader.read()).done).toBe(true);
  });

  it("reports renewal failures without sending an upstream request or exposing secrets", async () => {
    const gateway = await startCodexTokenGateway({
      getAccessToken: async () => {
        throw new Error("private-refresh-token");
      },
    });
    cleanup.push(gateway.close);
    const response = await fetch(`${gateway.baseUrl}/models`, {
      headers: { authorization: `Bearer ${gateway.secret}` },
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-refresh-token");
  });

  it("uses renewed credentials within the same running session and streams responses", async () => {
    const seen: Array<string | undefined> = [];
    const origin = await upstream((request, response) => {
      seen.push(request.headers.authorization);
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: first\n\n");
        response.end("data: last\n\n");
      });
    });
    let accessToken = "first-token";
    const gateway = await startCodexTokenGateway({
      upstream: origin,
      getAccessToken: async () => accessToken,
    });
    cleanup.push(gateway.close);
    const request = () =>
      fetch(`${gateway.baseUrl}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${gateway.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
    expect(await (await request()).text()).toBe("data: first\n\ndata: last\n\n");
    accessToken = "renewed-token";
    expect((await request()).status).toBe(200);
    expect(seen).toEqual(["Bearer first-token", "Bearer renewed-token"]);
  });

  it("does not access credentials for unauthenticated or unsupported requests", async () => {
    let reads = 0;
    const gateway = await startCodexTokenGateway({
      getAccessToken: async () => {
        reads++;
        return "private-token";
      },
    });
    cleanup.push(gateway.close);
    expect((await fetch(`${gateway.baseUrl}/models`)).status).toBe(401);
    expect(
      (
        await fetch(`${gateway.baseUrl}/files`, {
          headers: { authorization: `Bearer ${gateway.secret}` },
        })
      ).status,
    ).toBe(404);
    expect(reads).toBe(0);
  });

  it("fails without exposing credentials or replaying a failed upstream request", async () => {
    let requests = 0;
    const origin = await upstream((_request, response) => {
      requests++;
      response.writeHead(401).end('{"error":{"code":"token_expired"}}');
    });
    const gateway = await startCodexTokenGateway({
      upstream: origin,
      getAccessToken: async () => "private-token",
    });
    cleanup.push(gateway.close);
    expect(
      (
        await fetch(`${gateway.baseUrl}/responses`, {
          method: "POST",
          headers: { authorization: `Bearer ${gateway.secret}` },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect(requests).toBe(1);
  });
});
