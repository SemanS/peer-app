import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  dependencyState,
  PeerDependencyChangeInput,
  PeerDependencyChangeResult,
  PeerDependencySnapshot,
} from "./dependencies.ts";
const decodeSnapshot = Schema.decodeUnknownSync(PeerDependencySnapshot);
const decodeResult = Schema.decodeUnknownSync(PeerDependencyChangeResult);
const decodeInput = Schema.decodeUnknownSync(PeerDependencyChangeInput);
describe("dependencies contracts", () => {
  it("decodes snapshots and both outcomes, bounds each change", () => {
    expect(
      decodeSnapshot({
        workspace: "acme",
        available: true,
        projects: { app: { b: ["a"] } },
      }).projects.app?.b,
    ).toEqual(["a"]);
    expect(decodeResult({ kind: "cycle", path: ["a", "b", "a"] }).kind).toBe("cycle");
    expect(() =>
      decodeInput({
        workspace: "acme",
        projectId: "app",
        taskId: "a",
        add: Array(33).fill("b"),
      }),
    ).toThrow();
  });
  it("closed wins, merged requires every recorded thread's delivery", () => {
    expect(dependencyState({ status: "done" }, [{ delivery: "open" }])).toBe("done");
    expect(
      dependencyState({ status: "open" }, [{ delivery: "merged" }, { delivery: "merged" }]),
    ).toBe("merged");
    expect(dependencyState({ status: "open" }, [{ delivery: "merged" }, {}])).toBe("open");
    expect(dependencyState({ status: "open" }, [])).toBe("open");
    expect(dependencyState({ status: "review" }, [{}])).toBe("review");
  });
});
