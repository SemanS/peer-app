import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { impactHub } from "./client/hub.ts";
describe("impact Hub boundary", () => {
  it.effect("uses decoded public views and only treats missing routes as unsupported", () =>
    Effect.gen(function* () {
      const calls: Array<Record<string, unknown>> = [];
      const client = {
        request: (_schema: unknown, input: Record<string, unknown>) => {
          calls.push(input);
          return Effect.succeed({ records: [], provided: [] });
        },
      } as unknown as PeerHubClient["Service"];
      const hub = impactHub(client);
      expect(yield* hub.report("acme", "laptop", [])).toEqual({ records: [], provided: [] });
      yield* hub.view("acme");
      expect(calls[0]).toMatchObject({
        method: "PUT",
        path: "/impact",
        body: { environment: "laptop", footprints: [] },
      });
      const fallback = calls[0]!.unsupported as {
        when: (status: number, message: string) => boolean;
      };
      expect(fallback.when(404, "no such route")).toBe(true);
      expect(fallback.when(404, "no such impact overlap for this caller")).toBe(false);
    }),
  );
});
