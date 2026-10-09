// @effect-diagnostics nodeBuiltinImport:off - Peer Mod's requests on the broker's socket, and its log.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { brokerFixture } from "./testkit.ts";

describe("Peer Mod deliveries", () => {
  it("counts Mod delivery only after exact evidence and rejects receipts from a ended generation", async () => {
    const fixture = await brokerFixture();
    const post = (path: string, body: Record<string, unknown>, mod = true) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        const request = NodeHttp.request(
          {
            socketPath: NodePath.join(fixture.root, "peer.sock"),
            path,
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(mod ? { "x-peer-adapter": "mod" } : {}),
            },
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
        request.end(JSON.stringify(body));
      });
    try {
      await fixture.register("one");
      await fixture.broker.start();
      const original = fixture.broker["answerHook"];
      fixture.broker["answerHook"] = async () => ({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "Exact versioned source",
        },
      });
      const prepared = await post("/hook", {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "UserPromptSubmit",
      });
      const delivery = (JSON.parse(prepared.text) as { peerDelivery: { id: string } }).peerDelivery;
      const session = fixture.broker["sessions"].get("claude:one")!;
      expect(session.injected.size).toBe(0);
      expect(
        (await post("/delivery", { session_id: "one", id: delivery.id, evidence: "sent" })).status,
      ).toBe(400);
      expect(
        (await post("/delivery", { session_id: "one", id: "wrong", evidence: "model-input" }))
          .status,
      ).toBe(400);
      expect(
        (
          await post(
            "/delivery",
            { session_id: "one", id: delivery.id, evidence: "model-input" },
            false,
          )
        ).status,
      ).toBe(400);
      expect(
        (await post("/delivery", { session_id: "one", id: delivery.id, evidence: "model-input" }))
          .status,
      ).toBe(204);
      expect(
        (await post("/delivery", { session_id: "one", id: delivery.id, evidence: "model-input" }))
          .status,
      ).toBe(204);
      expect(session.injected.get("UserPromptSubmit")).toBe("Exact versioned source".length);
      fixture.broker["answerHook"] = original;
      await post("/hook", { session_id: "one", cwd: fixture.root, hook_event_name: "SessionEnd" });
      await fixture.register("one");
      await post("/hook", {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "Notification",
      });
      expect(
        (await post("/delivery", { session_id: "one", id: delivery.id, evidence: "model-input" }))
          .status,
      ).toBe(400);
      await fixture.broker.host.log.idle();
      const logs = (await NodeFSP.readFile(fixture.debugPath, "utf8"))
        .split("\n")
        .filter((line) => line.includes('"event":"delivery.verified"'));
      expect(logs).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });
});
