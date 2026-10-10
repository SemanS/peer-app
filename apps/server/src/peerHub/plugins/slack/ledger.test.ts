// @effect-diagnostics nodeBuiltinImport:off - reads peer-hub.json in a temporary state directory.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../../../config.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { hubKey, observe, over, slackLedger, type Entry } from "./ledger.ts";
import type { SlackWait } from "./waits.ts";

type Ledger = Parameters<typeof observe>[0];

const wait = (waitKey: string, workspace = "acme"): SlackWait => ({
  waitKey,
  subject: { key: "k", title: "t", agent: "Claude", computer: "Mac" },
  kind: "approval",
  workspace,
  project: "webshop",
  title: "t",
  since: "x",
});
const entry = (over: Partial<Entry> = {}): Entry => ({
  workspace: "acme",
  firstSeenAt: "2026-10-10T12:00:00.000Z",
  opened: false,
  closed: false,
  occurrence: 1,
  ...over,
});
const ledger = (waits: Record<string, Entry> = {}): Ledger => ({ waits, delivered: {} });
const NOON = Date.parse("2026-10-10T12:00:00Z");
const known = new Set(["acme"]);

describe("what the Slack ledger remembers of the waits", () => {
  it("starts an occurrence when a wait is first seen, and keeps the time it was", () => {
    const first = observe(ledger(), [wait("k1")], known, NOON);
    expect(first.waits["k1"]).toEqual(entry());
    const later = observe(first, [wait("k1")], known, NOON + 60_000);
    expect(later).toBe(first);
  });

  it("forgets a wait that goes before it was opened", () => {
    const seen = observe(ledger(), [wait("k1")], known, NOON);
    expect(observe(seen, [], known, NOON + 1).waits).toEqual({});
  });

  it("keeps an opened wait until the Hub has been told, then its place for the next occurrence", () => {
    const opened = ledger({ k1: entry({ opened: true }) });
    expect(observe(opened, [], known, NOON)).toBe(opened);
    const told = ledger({ k1: over(entry({ opened: true })) });
    expect(told.waits["k1"]).toEqual(
      entry({ firstSeenAt: null, opened: false, closed: false, occurrence: 2 }),
    );
    // The key is seen again: the second occurrence begins now, and the Hub knows it as `k1#2`.
    const again = observe(told, [wait("k1")], known, NOON + 5 * 60_000);
    expect(again.waits["k1"]).toMatchObject({
      firstSeenAt: "2026-10-10T12:05:00.000Z",
      occurrence: 2,
    });
    expect(hubKey("k1", again.waits["k1"]!)).toBe("k1#2");
    expect(hubKey("k1", entry())).toBe("k1");
  });

  it("moves a closed wait that goes on to its next occurrence without anything to tell the Hub", () => {
    const closed = ledger({ k1: entry({ opened: true, closed: true }) });
    expect(observe(closed, [wait("k1")], known, NOON)).toBe(closed);
    expect(observe(closed, [], known, NOON).waits["k1"]).toMatchObject({
      firstSeenAt: null,
      opened: false,
      occurrence: 2,
    });
  });

  it("keeps the place of an occurrence that came and went unopened after an opened one", () => {
    const second = ledger({ k1: entry({ occurrence: 2 }) });
    expect(observe(second, [], known, NOON).waits["k1"]).toMatchObject({
      firstSeenAt: null,
      occurrence: 2,
    });
  });

  it("leaves the waits of workspaces it does not know alone", () => {
    const elsewhere = ledger({
      k1: entry({ workspace: "other", opened: true }),
      k2: entry({ workspace: "other" }),
    });
    expect(observe(elsewhere, [], known, NOON)).toBe(elsewhere);
  });

  it("keeps the last 200 closed keys", () => {
    const waits = Object.fromEntries(
      Array.from({ length: 205 }, (_, i) => [`k${i}`, entry({ firstSeenAt: null, occurrence: 2 })]),
    );
    const kept = Object.keys(observe(ledger(waits), [], known, NOON).waits);
    expect(kept).toHaveLength(200);
    expect(kept[0]).toBe("k5");
  });
});

describe("where the Slack ledger is kept", () => {
  it.effect("is the slack slice of peer-hub.json, and survives a restart", () =>
    Effect.gen(function* () {
      const baseDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
        prefix: "slack-ledger-",
      });
      const start = PeerState.PeerState.pipe(
        Effect.provide(
          PeerState.layer.pipe(
            Layer.provide(
              Layer.merge(
                ServerConfig.layerTest(process.cwd(), baseDir),
                Layer.mock(ServerEnvironment.ServerEnvironment)({
                  getEnvironmentId: Effect.succeed(EnvironmentId.make("ana-laptop")),
                }),
              ),
            ),
          ),
        ),
      );
      const state = yield* start;
      const ours = slackLedger(state);
      expect(yield* ours.read).toEqual(ledger());
      yield* ours.update((l) => ({
        waits: { ...l.waits, k1: entry({ opened: true }) },
        delivered: { a1: { workspace: "acme", result: "delivered" } },
      }));
      const text = yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(baseDir, "userdata", "peer-hub.json"), "utf8"),
      );
      expect(text).toContain('"pluginData":{"slack":{"waits":{"k1":');
      const restarted = slackLedger(yield* start);
      expect(yield* restarted.read).toEqual({
        waits: { k1: entry({ opened: true }) },
        delivered: { a1: { workspace: "acme", result: "delivered" } },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
