import type { PeerAcceptanceSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { badgeText, sectionView } from "./acceptance.logic";

const ANA = "ana@acme.test";
const AT = "2026-10-28T10:00:00Z";
const name = (email: string) => (email === ANA ? "Ana" : email);
const clock = (at: string) => at.slice(11, 16);
const summary: PeerAcceptanceSummary = {
  workspace: "acme",
  project: "pay",
  task: "vl7",
  by: ANA,
  at: AT,
  statusThen: "review",
};

describe("acceptance on the phone", () => {
  it("says who accepted, with the note once the task's page read it", () => {
    expect(sectionView(summary, undefined, "done", name, clock)).toMatchObject({
      heading: "Accepted by Ana · 10:00",
      note: undefined,
      accepted: true,
    });
    const view = sectionView(
      summary,
      {
        workspace: "acme",
        project: "pay",
        task: "vl7",
        current: { by: ANA, at: AT, note: "Checked on staging", statusThen: "review" },
        history: [{ kind: "accepted", by: ANA, at: AT, note: "Checked on staging" }],
      },
      "open",
      name,
      clock,
    );
    expect(view?.heading).toBe("Accepted by Ana · 10:00 · before reopening");
    expect(view?.note).toBe("Checked on staging");
    expect(view?.history.map((row) => row.line)).toEqual(["Accepted by Ana · 10:00"]);
  });

  it("says a done task is not accepted, lists a withdrawal, and is silent for open work", () => {
    expect(sectionView(undefined, undefined, "done", name, clock)?.heading).toBe(
      "Done · not accepted",
    );
    const withdrawn = sectionView(
      undefined,
      {
        workspace: "acme",
        project: "pay",
        task: "vl7",
        current: null,
        history: [{ kind: "withdrawn", by: ANA, at: "2026-10-28T11:00:00Z", note: "Refunds" }],
      },
      "done",
      name,
      clock,
    );
    expect(withdrawn?.history[0]).toMatchObject({
      line: "Withdrawn by Ana · 11:00",
      note: "Refunds",
    });
    expect(sectionView(undefined, undefined, "review", name, clock)).toBeNull();
    expect(badgeText(summary, "done")).toBe("Accepted");
    expect(badgeText(undefined, "done")).toBeNull();
  });
});
