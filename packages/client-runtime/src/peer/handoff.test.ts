import { describe, expect, it } from "vite-plus/test";
import fixture from "../../../contracts/src/peer/handoff.fixture.json" with { type: "json" };
import * as Schema from "effect/Schema";
import { PeerHandoffPackage } from "@t3tools/contracts";
import {
  canHandOff,
  contextMovedOn,
  handoffLines,
  handoffLineText,
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
    expect(contextMovedOn(p, 9)).toContain("v9");
    expect(contextMovedOn(p, null)).toContain("no longer exists");
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
