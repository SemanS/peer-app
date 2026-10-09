// @effect-diagnostics nodeBuiltinImport:off - requests on the broker's socket, in a temporary checkout.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import { refused } from "./cliContract.ts";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

describe("the broker's socket", () => {
  it("never dispatches a command whose arguments were cut off", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      session.claims = ["important.ts"];
      await fixture.broker.start();
      const closed = Promise.withResolvers<void>();
      fixture.broker.server!.once("request", (request) =>
        request.once("close", () => closed.resolve()),
      );
      const client = NodeNet.createConnection(fixture.broker.host.socketPath);
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      client.write(
        "POST /cli/release HTTP/1.1\r\nHost: peer\r\nX-Peer-Session: one\r\nContent-Length: 100\r\n\r\npartial",
      );
      // Wait until the server has parsed the request before cutting its body short.
      await new Promise<void>((resolve) => fixture.broker.server!.once("request", () => resolve()));
      client.destroy();
      await closed.promise;
      await fixture.broker.host.log.idle();
      expect(session.claims).toEqual(["important.ts"]);
      const log = await NodeFSP.readFile(fixture.debugPath, "utf8");
      expect(log).not.toContain('"event":"release"');
    } finally {
      await fixture.dispose();
    }
  });
  it("classifies done, usage, refusal and unexpected plugin failures, verifying before dispatch", async () => {
    const ran = vi.fn();
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        commands: [
          {
            plugin: "test",
            command: {
              name: "test-command",
              usage: "test-command",
              summary: "test",
              run: ({ plain }) => {
                ran();
                if (plain[0] === "unknown") throw new Error("plugin failed");
                return plain[0] === "refused"
                  ? Effect.fail(refused("plugin declined", "read its context."))
                  : Effect.succeed("Done.");
              },
            },
          },
        ],
      }),
    }));
    const post = (command: string, args: string[], session?: string) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        const request = NodeHttp.request(
          {
            socketPath: fixture.broker.host.socketPath,
            path: `/cli/${command}`,
            method: "POST",
            headers: session === undefined ? {} : { "x-peer-session": session },
          },
          (response) => {
            let text = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              text += chunk;
            });
            response.on("end", () => resolve({ status: response.statusCode!, text }));
          },
        );
        request.on("error", reject);
        request.end(args.map((arg) => `${arg}\0`).join(""));
      });
    try {
      await fixture.register("one");
      await fixture.broker.start();
      expect((await post("help", [])).status).toBe(200);
      expect(await post("frobnicate", [])).toMatchObject({
        status: 400,
        text: expect.stringMatching(/^peer: usage:/),
      });
      expect(await post("test-command", [])).toMatchObject({
        status: 409,
        text: expect.stringMatching(/^peer: refused:/),
      });
      expect(ran).not.toHaveBeenCalled();
      expect(await post("test-command", [], "one")).toEqual({ status: 200, text: "Done.\n" });
      expect(await post("test-command", ["refused"], "one")).toMatchObject({
        status: 409,
        text: "peer: refused: plugin declined.\nNext: read its context.\n",
      });
      expect(await post("test-command", ["unknown"], "one")).toMatchObject({
        status: 500,
        text: expect.stringContaining("peer test-command may or may not have taken effect"),
      });
      await fixture.broker.host.log.idle();
      const log = await NodeFSP.readFile(fixture.debugPath, "utf8");
      expect(log).toContain('"event":"broker.error"');
      expect(log).toContain('"outcome":"uncertain"');
      const session = fixture.broker.sessions.get("claude:one")!;
      session.claims = ["important.ts"];
      expect(
        (
          await post(
            "release",
            Array.from({ length: 201 }, () => "important.ts"),
            "one",
          )
        ).status,
      ).toBe(400);
      expect(session.claims).toEqual(["important.ts"]);
    } finally {
      await fixture.dispose();
    }
  });

  it("replaces scripts atomically while an open handle keeps the previous generation", async () => {
    const fixture = await brokerFixture();
    try {
      const script = fixture.broker.scripts.peer;
      await NodeFSP.mkdir(NodePath.dirname(script), { recursive: true });
      await NodeFSP.writeFile(script, "old script");
      const handle = await NodeFSP.open(script, "r");
      try {
        await fixture.broker.start();
        expect(await handle.readFile("utf8")).toBe("old script");
        expect(await NodeFSP.readFile(script, "utf8")).toContain("cmd=");
        expect((await NodeFSP.stat(script)).mode & 0o111).toBe(0o111);
      } finally {
        await handle.close();
      }
    } finally {
      await fixture.dispose();
    }
  });
  it("returns a failure status when a CLI caller has no registered session", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("another-agent");
      await fixture.broker.start();
      for (const command of ["status", "claim", "context", "note"]) {
        const answer = await new Promise<{ status: number; text: string }>((resolve, reject) => {
          const request = NodeHttp.request(
            {
              socketPath: NodePath.join(fixture.root, "peer.sock"),
              path: `/cli/${command}`,
              method: "POST",
              headers: { "x-peer-session": "codex:unknown", "x-peer-cwd": fixture.root },
            },
            (response) => {
              let text = "";
              response.setEncoding("utf8");
              response.on("data", (chunk) => {
                text += chunk;
              });
              response.on("error", reject);
              response.on("end", () => resolve({ status: response.statusCode!, text }));
            },
          );
          request.on("error", reject);
          request.end();
        });
        expect(answer.status).toBe(409);
        expect(answer.text).toContain("no registered agent session");
      }
    } finally {
      await fixture.dispose();
    }
  });
});
