// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - HTTP over the broker's Unix socket.
/**
 * The terminal's `peer core` process never writes `peer-hub.json` while a broker owns the socket:
 * it asks that broker, Peer Core's here, to create the run (design D5).
 */
import * as NodeHttp from "node:http";

import { describe, expect, it } from "@effect/vitest";

import { CoordinationBroker } from "../core/broker/Broker.ts";
import { brokerFixture } from "../core/broker/testkit.ts";
import { RunBook, stateOf } from "../core/work/runs.ts";

const call = (socketPath: string, method: "GET" | "POST", path: string, body?: unknown) =>
  new Promise<{ readonly status: number; readonly json: Record<string, unknown> }>(
    (resolve, reject) => {
      const request = NodeHttp.request({ socketPath, method, path }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, json: JSON.parse(text || "{}") }),
        );
      });
      request.on("error", reject);
      request.end(body === undefined ? "" : JSON.stringify(body));
    },
  );

describe("runs over Peer Core's socket", () => {
  it("a peer core process creates, lists and ends a run through the running broker", async () => {
    const saved: Array<unknown> = [];
    const runs = new RunBook(
      {},
      {
        environment: "test",
        email: () => "ana@acme.test",
        now: () => Date.parse("2026-10-30T10:00:00Z"),
        save: async (next) => {
          saved.push(next);
        },
      },
    );
    const fixture = await brokerFixture(() => ({ runs }));
    const core = new CoordinationBroker(fixture.broker.host, { kind: "peer-core" });
    try {
      await core.start();
      const socket = fixture.broker.host.socketPath;
      const asked = {
        workspace: "acme",
        project: "app",
        task: "krk-1",
        agent: "claude",
        runtime: "terminal",
        requestId: "menu-1",
      };
      const created = await call(socket, "POST", "/runs", asked);
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({ task: "krk-1" });
      const id = String(created.json.id);
      expect(runs.claim(id, String(created.json.token))).toBe(true);
      // Written to disk by the broker that owns the socket.
      expect(saved.length).toBeGreaterThan(0);
      // The menu's retry of the same Start a task creates no second run.
      expect((await call(socket, "POST", "/runs", asked)).json.id).toBe(id);
      expect((await call(socket, "POST", "/runs", { workspace: "acme" })).status).toBe(400);

      const listed = await call(socket, "GET", "/runs?workspace=acme&project=app&task=krk-1");
      expect(
        (listed.json.runs as ReadonlyArray<{ id: string; state: string }>).map((r) => [
          r.id,
          r.state,
        ]),
      ).toEqual([[id, "detached"]]);
      const ended = await call(socket, "POST", `/runs/${id}/end`);
      expect(ended.json).toMatchObject({ id, state: "ended", outcome: "stopped" });
      expect(stateOf(runs.get(id)!)).toBe("ended");
      expect((await call(socket, "POST", "/runs/run_missing/end")).status).toBe(404);
    } finally {
      await core.stop();
      await fixture.dispose();
    }
  });

  it("a person attaches a live session to a run, then continues the run once it is detached", async () => {
    const runs = new RunBook(
      {},
      {
        environment: "test",
        email: () => "ana@acme.test",
        now: () => Date.parse("2026-10-30T10:00:00Z"),
        save: async () => undefined,
      },
    );
    const fixture = await brokerFixture(() => ({ runs }));
    const core = new CoordinationBroker(fixture.broker.host, { kind: "peer-core" });
    try {
      await core.start();
      const socket = fixture.broker.host.socketPath;
      const { run, token } = await runs.create({
        workspace: "acme",
        project: "app",
        task: "krk-1",
        agent: "claude",
        runtime: "terminal",
      });
      await core.sessionFor("claude", { session_id: "one", cwd: fixture.root }, undefined);
      const session = core.sessions.get("claude:one")!;
      expect(session.run).toBeUndefined();

      expect(
        (await call(socket, "POST", `/runs/${run.id}/attach`, { session: "two" })).status,
      ).toBe(404);
      expect(
        (await call(socket, "POST", "/runs/run_missing/attach", { session: "one" })).status,
      ).toBe(404);
      const attached = await call(socket, "POST", `/runs/${run.id}/attach`, { session: "one" });
      expect(attached.status).toBe(200);
      expect(attached.json.run).toMatchObject({
        id: run.id,
        state: "running",
        sessions: [{ id: "claude:one" }],
      });
      expect([session.run, session.task]).toEqual([run.id, "krk-1"]);

      // A run with a live session is not continued; once its session ended it is, with a new token.
      expect((await call(socket, "POST", `/runs/${run.id}/continue`)).status).toBe(409);
      await runs.detach(run.id, "claude:one");
      const continued = await call(socket, "POST", `/runs/${run.id}/continue`);
      expect(continued.status).toBe(200);
      const env = continued.json.env as Record<string, string>;
      expect(env).toMatchObject({ PEER_RUN: run.id, PEER_TASK: "krk-1" });
      expect(continued.json.resume).toEqual({ agent: "claude", session: "one" });
      expect(runs.claim(run.id, env.PEER_RUN_TOKEN)).toBe(true);
      expect(runs.claim(run.id, token)).toBe(false);
      expect((await call(socket, "POST", "/runs/run_missing/continue")).status).toBe(404);

      await runs.end(run.id, "done");
      expect((await call(socket, "POST", `/runs/${run.id}/continue`)).status).toBe(409);
      expect(
        (await call(socket, "POST", `/runs/${run.id}/attach`, { session: "one" })).status,
      ).toBe(409);
    } finally {
      await core.stop();
      await fixture.dispose();
    }
  });
});
