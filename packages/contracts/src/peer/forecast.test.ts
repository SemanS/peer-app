import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { PeerForecast, PeerForecastConfigure, boundForecast } from "./forecast.ts";
const decode = Schema.decodeUnknownSync(PeerForecast),
  configure = Schema.decodeUnknownSync(PeerForecastConfigure);
describe("forecast wire contract", () => {
  it("round trips empty options and an oversized source snapshot within the wire budget", () => {
    expect(configure({})).toEqual({});
    const side = {
      branch: "feature/a",
      email: "ana@test",
      title: "Ana's task",
      where: "here" as const,
    };
    const source = {
      state: "on" as const,
      teammates: false,
      tracked: 8,
      skipped: 0,
      notOnOrigin: 0,
      paused: [],
      pairs: Array.from({ length: 30 }, (_, i) => ({
        workspace: "acme",
        project: "app",
        repository: "api",
        a: { ...side, branch: `feature/a-${i}` },
        b: { ...side, branch: `feature/b-${i}` },
        files: Array.from({ length: 20 }, (_, j) => `${j}-` + "x".repeat(100)),
        more: 0,
        checkedAt: "2026-10-09T12:00:00Z",
      })),
    };
    const bounded = boundForecast(source);
    expect(new TextEncoder().encode(JSON.stringify(bounded)).length).toBeLessThan(64 * 1024);
    expect(decode(JSON.parse(JSON.stringify(bounded)))).toEqual(bounded);
    expect(source.pairs[29]?.files).toHaveLength(20);
    expect(bounded.pairs.some((p) => p.more > 0)).toBe(true);
  });

  const legacy = Schema.decodeUnknownSync(
    Schema.Struct({
      state: Schema.Literals(["on", "off", "unsupported"]),
      teammates: Schema.Boolean,
      pairs: Schema.Array(
        Schema.Struct({
          workspace: Schema.String,
          a: Schema.Struct({ branch: Schema.String, where: Schema.Literals(["here", "origin"]) }),
          b: Schema.Struct({ branch: Schema.String, where: Schema.Literals(["here", "origin"]) }),
          checkedAt: Schema.String,
        }),
      ),
    }),
  );
  const side = (branch: string) => ({
    branch,
    email: "ana@test",
    title: branch,
    where: "here" as const,
  });
  const base = {
    state: "on" as const,
    teammates: true,
    tracked: 2,
    skipped: 0,
    notOnOrigin: 0,
    paused: [],
  };
  const pair = {
    workspace: "acme",
    project: "app",
    repository: "api",
    a: side("a"),
    b: side("b"),
    files: ["order.js"],
    more: 0,
    checkedAt: "2026-10-18T14:57:00Z",
  };

  it("decodes a status from before the change, with none of the new fields", () => {
    const decoded = decode({ ...base, pairs: [pair] });
    expect(decoded.pairs[0]?.a.source).toBeUndefined();
    expect(decoded.pairs[0]?.check).toBeUndefined();
    expect(decoded.shareWip).toBeUndefined();
    expect(configure({ teammates: true })).toEqual({ teammates: true });
  });

  it("round trips the new fields, and an older reader still decodes them", () => {
    const next = {
      ...base,
      shareWip: true,
      check: "npm test",
      pairs: [
        {
          ...pair,
          a: { ...side("a"), source: "shared" as const, readAt: "2026-10-18T14:56:00Z" },
          b: { ...side("b"), source: "pushed" as const },
          check: {
            state: "fails" as const,
            output: "x".repeat(600),
            at: "2026-10-18T14:57:00Z",
            commits: ["a".repeat(40), "b".repeat(40)],
          },
          inheritedFrom: { side: "b" as const, branch: "feature/ORD-11", task: "ORD-11" },
          later: "b" as const,
        },
      ],
    };
    expect(decode(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(legacy(JSON.parse(JSON.stringify(next))).pairs).toHaveLength(1);
    expect(configure({ shareWip: true, check: "npm test" })).toEqual({
      shareWip: true,
      check: "npm test",
    });
  });

  it("states every check outcome and refuses a longer output or command", () => {
    for (const state of ["passed", "fails", "timedOut", "couldNotRead"] as const) {
      const check = { state, at: "2026-10-18T14:57:00Z", commits: [] };
      expect(decode({ ...base, pairs: [{ ...pair, check }] }).pairs[0]?.check?.state).toBe(state);
    }
    const long = { state: "fails", output: "x".repeat(601), at: "t", commits: [] };
    expect(() => decode({ ...base, pairs: [{ ...pair, check: long }] })).toThrow();
    expect(() => configure({ check: "x".repeat(201) })).toThrow();
    expect(configure({ check: "x".repeat(200) }).check).toHaveLength(200);
  });

  it("cuts a check's output to its limit when it bounds a snapshot", () => {
    const check = { state: "fails" as const, output: "y".repeat(900), at: "t", commits: [] };
    const bounded = boundForecast({ ...base, pairs: [{ ...pair, check }] });
    expect(bounded.pairs[0]?.check?.output).toHaveLength(600);
    expect(decode(bounded).pairs).toHaveLength(1);
  });
});
