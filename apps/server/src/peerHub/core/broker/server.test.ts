// @effect-diagnostics nodeBuiltinImport:off - requests on the broker's socket, in a temporary checkout.
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { brokerFixture } from "./testkit.ts";

describe("the broker's socket", () => {
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
        expect(answer.text).toContain("no agent session");
      }
    } finally {
      await fixture.dispose();
    }
  });
});
