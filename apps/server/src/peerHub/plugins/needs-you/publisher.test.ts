import { describe, expect, it } from "@effect/vitest";
import { RelayAgentActivityState } from "@t3tools/contracts/relay";
import * as Schema from "effect/Schema";
import { emptyLedger, type AlertLedger } from "./ledger.ts";
import { Publisher } from "./publisher.ts";
import { richStatus, NOW } from "./testkit.ts";

const decode = Schema.decodeUnknownSync(RelayAgentActivityState);

describe("stable local alert episodes", () => {
  const fixture = () => {
    let disk: AlertLedger = emptyLedger();
    const calls: Array<{ id: string; state: RelayAgentActivityState | null }> = [],
      logs: object[] = [];
    const io = {
      read: async () => disk,
      write: async (value: AlertLedger) => {
        disk = structuredClone(value);
      },
    };
    const create = () =>
      new Publisher(
        io,
        async (id, state) => {
          calls.push({ id, state });
        },
        (fields) => {
          logs.push(fields);
        },
      );
    return { create, calls, logs, disk: () => disk };
  };
  it("starts off, emits waiting points once and keeps churn and logs free of titles", async () => {
    const f = fixture(),
      p = f.create();
    await p.load();
    await p.reconcile(richStatus(), [], NOW);
    expect(f.calls).toEqual([]);
    await p.setAlerts(true);
    await p.reconcile(richStatus(), [], NOW);
    expect(f.calls).toHaveLength(3);
    for (const call of f.calls) {
      expect(() => decode(call.state)).not.toThrow();
      expect(call.state?.deepLink).toBe(`/threads/computer/${call.id}`);
    }
    await p.reconcile({ ...richStatus(), syncing: true }, [], NOW + 60_000);
    expect(f.calls).toHaveLength(3);
    expect(JSON.stringify(f.logs)).not.toMatch(/Ship work|Agent work|Review work|PRIVATE_/);
  });
  it("reconstructs retained timestamps on restart and withdraws work resolved during downtime", async () => {
    const f = fixture(),
      p = f.create();
    await p.load();
    await p.setAlerts(true);
    await p.reconcile(richStatus(), [], NOW);
    const since = f.calls[0]?.state?.updatedAt;
    f.calls.length = 0;
    const restarted = f.create();
    await restarted.load();
    await restarted.reconcile(richStatus(), [], NOW + 30_000);
    expect(f.calls).toEqual([]);
    expect(restarted.source()[0]?.state.updatedAt).toBe(since);
    await restarted.reconcile({ ...richStatus(), requests: [] }, [], NOW + 40_000);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.state).toBeNull();
  });
  it("gives blocked, answered, blocked a new episode and withdraws all when switched off or signed out", async () => {
    const f = fixture(),
      p = f.create();
    await p.load();
    await p.setAlerts(true);
    const status = {
      ...richStatus(),
      requests: [],
      coordination: { ...richStatus().coordination, overlaps: [] },
    };
    await p.reconcile(status, [], NOW);
    const first = f.calls[0]?.state?.updatedAt;
    await p.reconcile(
      {
        ...status,
        agents: {
          ...status.agents,
          list: status.agents.list.map((a) => ({ ...a, status: "working" })),
        },
      },
      [],
      NOW + 1000,
    );
    await p.reconcile(status, [], NOW + 2000);
    expect(f.calls.map((c) => c.state?.phase ?? null)).toEqual([
      "waiting_for_input",
      null,
      "waiting_for_input",
    ]);
    expect(f.calls[2]?.state?.updatedAt).not.toBe(first);
    await p.setAlerts(false);
    await p.reconcile(status, [], NOW + 3000);
    expect(f.disk().published).toEqual({});
    expect(p.source()).toEqual([]);
    await p.setAlerts(true);
    await p.reconcile(status, [], NOW + 4000);
    await p.reconcile({ ...status, signedIn: false }, [], NOW + 5000);
    expect(f.calls.at(-1)?.state).toBeNull();
    expect(f.disk().published).toEqual({});
  });
});
