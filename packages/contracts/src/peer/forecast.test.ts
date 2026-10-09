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
});
