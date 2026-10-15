import { describe, expect, it } from "vite-plus/test";
import fixture from "../../../contracts/src/peer/handoff.fixture.json" with { type: "json" };
import * as Schema from "effect/Schema";
import { PeerHandoffPackage } from "@t3tools/contracts";
import {
  canHandOff,
  contextMovedOn,
  contextMovedLine,
  contextWritten,
  currentContextVersion,
  handoffLines,
  handoffLineText,
  inputLabel,
  inputState,
  isEarlierHandoff,
  packageRows,
  outcomeText,
  handoffRevision,
  shortenedNote,
} from "./handoff.ts";
const p = Schema.decodeUnknownSync(PeerHandoffPackage)(fixture);
describe("reviewer facts", () => {
  it("offers any own harness, hides done/other people's work and shows earlier contexts", () => {
    const thread = { task: "a", email: "ana" };
    expect(canHandOff({ id: "a", status: "open" }, [thread], "ana")).toBe("Hand off for review");
    expect(canHandOff({ id: "a", status: "review" }, [thread], "ana")).toBe("Update handoff");
    expect(canHandOff({ id: "a", status: "done" }, [thread], "ana")).toBeNull();
    expect(canHandOff({ id: "a", status: "open" }, [thread], "ben")).toBeNull();
    expect(isEarlierHandoff({ status: "open" })).toBe(true);
    expect(packageRows(p).join("\n")).toContain("changed since read");
    expect(
      packageRows({ ...p, overlaps: p.overlaps.filter((o) => o.state === "open") }).join("\n"),
    ).not.toContain("they rename first");
  });
  it("invalidates when any author's package changes without relying on the largest number", () => {
    const first = [{ author: "ana", number: 2 }];
    expect(handoffRevision(first)).not.toBe(
      handoffRevision([...first, { author: "ben", number: 1 }]),
    );
    expect(handoffRevision([...first, { author: "ben", number: 1 }])).not.toBe(
      handoffRevision([...first, { author: "ben", number: 2 }]),
    );
    expect(handoffRevision(first, 1)).not.toBe(handoffRevision(first));
  });
  it("keeps outcomes on one line", () => {
    const lines = outcomeText({
      workspace: "a",
      project: "a",
      task: "a",
      stored: true,
      number: 2,
      contextVersion: 7,
      changed: false,
      notices: ["one\ntwo"],
      targets: [{ url: "https://github.com/o/r/pull/1", kind: "failed", reason: "signed out" }],
    });
    expect(lines.every((l) => !l.includes("\n"))).toBe(true);
  });
});
describe("handoff lines", () => {
  it("lose one leading bullet and keep the markdown", () => {
    expect(handoffLineText("- `src/print/receipt.ts` prints the header")).toBe(
      "`src/print/receipt.ts` prints the header",
    );
    expect(handoffLineText("* a")).toBe("a");
    expect(handoffLineText("• a")).toBe("a");
    expect(handoffLineText("  -   spaced out  ")).toBe("spaced out");
    expect(handoffLineText("- - nested")).toBe("- nested");
  });
  it("keep text that only looks like a bullet", () => {
    expect(handoffLineText("-1 degree")).toBe("-1 degree");
    expect(handoffLineText("**bold** first")).toBe("**bold** first");
    expect(handoffLineText("*emphasis* first")).toBe("*emphasis* first");
    expect(handoffLineText("1. first")).toBe("1. first");
    expect(handoffLineText("plain")).toBe("plain");
  });
  it("show no empty bullet and key repeated lines apart", () => {
    expect(handoffLines(["- a", "-", "   ", "- a", "b"])).toEqual([
      { id: "- a:0", text: "a" },
      { id: "- a:1", text: "a" },
      { id: "b:0", text: "b" },
    ]);
  });
  it("say where the rest of a shortened section is", () => {
    expect(shortenedNote()).toBe("Peer keeps 8 lines per section; the rest is in the chat.");
    expect(shortenedNote("Ana")).toBe(
      "Peer keeps 8 lines per section; the rest is in Ana’s chat, on their computer.",
    );
  });
});
describe("the task context moved on", () => {
  it("is the version the handoff was built from and the one there is now", () => {
    expect(contextMovedOn(p, 9)).toEqual({ read: 7, latest: 9, context: "task:krk-335" });
    expect(contextMovedOn(p, null)).toEqual({ read: 7, latest: null, context: "task:krk-335" });
    expect(contextMovedOn(p, 7)).toBeNull();
    expect(contextMovedOn({ ...p, context: null }, 9)).toBeNull();
  });
  it("is not claimed where this computer cannot see contexts, since none would look absent", () => {
    const context = (version: number) => ({
      workspace: "acme",
      project: "shop",
      scope: "task:krk-335",
      version,
      updatedAt: "2026-10-15T10:00:00Z",
      bytes: 10,
    });
    const place = { workspace: "acme", projectId: "shop", taskId: "krk-335" };
    const on = (contexts: ReturnType<typeof context>[]) => ({ enabled: true, contexts });
    expect(currentContextVersion(on([context(9)]), place)).toBe(9);
    expect(currentContextVersion(on([]), place)).toBeNull();
    expect(currentContextVersion(on([{ ...context(9), project: "other" }]), place)).toBeNull();
    // Coordination off: the contexts list is empty because nothing reads it, not because they are gone.
    const off = currentContextVersion({ enabled: false, contexts: [] }, place);
    expect(off).toBeUndefined();
    expect(contextMovedOn(p, off)).toBeNull();
    expect(contextMovedLine(p, off)).toBeNull();
  });
  it("reads as a sentence where there is no banner", () => {
    expect(contextMovedLine(p, 9)).toBe(
      "The task context changed after this handoff: it was built from v7, the latest is v9.",
    );
    expect(contextMovedLine(p, null)).toBe(
      "The task context changed after this handoff: it was built from v7 and no longer exists.",
    );
    expect(contextMovedLine(p, 7)).toBeNull();
  });
  it("says who wrote the latest version", () => {
    const name = (email: string) => (email === "ana@acme.test" ? "Ana" : "a teammate");
    const me = "ben@acme.test";
    expect(
      contextWritten({ updatedBy: "ana@acme.test", updatedSession: "claude:1" }, name, me),
    ).toBe("written by Ana’s agent");
    expect(contextWritten({ updatedBy: me, updatedSession: "claude:1" }, name, me)).toBe(
      "written by your agent",
    );
    expect(contextWritten({ updatedBy: "ana@acme.test", restoredFrom: 2 }, name, me)).toBe(
      "restored from v2 by Ana",
    );
    expect(contextWritten({ updatedBy: me, restoredFrom: 2 }, name, me)).toBe(
      "restored from v2 by you",
    );
    expect(contextWritten({}, name, me)).toBe("");
    expect(contextWritten(undefined, name, null)).toBe("");
  });
  it("tells an input that is current from one that changed or is gone", () => {
    const [task, project] = p.inputs;
    expect(inputLabel(task!)).toBe("KRK-310 task context");
    expect(inputState(task!)).toBe("current");
    expect(inputLabel(project!)).toBe("Project context");
    expect(inputState(project!)).toBe("changed");
    expect(inputLabel({ scope: "task:x", title: "Resolver cache" })).toBe(
      "Resolver cache task context",
    );
    expect(inputState({ readVersion: 2, currentVersion: null })).toBe("gone");
  });
});
