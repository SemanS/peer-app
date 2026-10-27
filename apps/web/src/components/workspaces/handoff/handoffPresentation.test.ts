import type { PeerHandoffPackage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { handoffPresentation } from "./handoffPresentation";

const PACKAGE: PeerHandoffPackage = {
  number: 2,
  project: "app",
  task: "intake",
  title: "Import text PDFs",
  author: "ana@example.test",
  source: "agent",
  composedAt: "2026-10-22T08:00:00Z",
  context: null,
  inputs: [],
  overlaps: [],
  pullRequests: [],
};

describe("the handoff summary", () => {
  it("keeps shortened blocker coverage separate when no visible line reports a blocker", () => {
    const shown = handoffPresentation({
      ...PACKAGE,
      context: {
        version: 1,
        updatedAt: PACKAGE.composedAt,
        gist: null,
        sections: [{ name: "Blockers", shortened: true, lines: ["None for the import."] }],
        projectLines: [],
      },
    });
    expect(shown.blockers).toBeUndefined();
    expect(shown.blockersShortened).toBe(true);
  });
  it("does not raise attention for explicit no-blocker prose in a saved handoff", () => {
    const context = {
      version: 1,
      updatedAt: PACKAGE.composedAt,
      gist: null,
      sections: [
        {
          name: "Blockers",
          shortened: false,
          lines: ["None for the import. Feature tasks intentionally remain open."],
        },
      ],
      projectLines: [],
    } as const;
    const shown = handoffPresentation({ ...PACKAGE, context });
    expect(shown.blockers).toBeUndefined();
    expect(shown.sections).toEqual([]);
    const mixed = handoffPresentation({
      ...PACKAGE,
      context: {
        ...context,
        sections: [
          { name: "Blockers", shortened: false, lines: ["None.", "Waiting for approval."] },
        ],
      },
    });
    expect(mixed.blockers?.lines).toEqual(["Waiting for approval."]);
  });
  it("separates the result, blockers and next step from the full report without losing lines", () => {
    const sections = [
      { name: "Next", shortened: false, lines: ["Review the PR."] },
      { name: "State", shortened: false, lines: ["Agent reports local tests passed."] },
      { name: "Blockers", shortened: false, lines: ["CI did not run: spending limit."] },
      { name: "Decisions", shortened: false, lines: ["Keep the partner event IDs."] },
      { name: "Provides", shortened: true, lines: ["PDF import.", "Regression tests."] },
    ] as const;
    const shown = handoffPresentation({
      ...PACKAGE,
      context: {
        version: 1,
        updatedAt: PACKAGE.composedAt,
        gist: null,
        sections,
        projectLines: [],
      },
    });

    expect(shown.result?.lines).toEqual(["PDF import.", "Regression tests."]);
    expect(shown.blockers?.lines).toEqual(["CI did not run: spending limit."]);
    expect(shown.next?.lines).toEqual(["Review the PR."]);
    expect(shown.sections).toEqual(sections);
  });

  it("keeps every open overlap and stale or deleted input in the attention summary", () => {
    const overlaps = [
      { state: "settled", files: ["api.ts"], partner: null, at: PACKAGE.composedAt },
      { state: "open", files: ["schema.ts"], partner: null, at: PACKAGE.composedAt },
      { state: "open", files: ["docs.md"], partner: null, at: PACKAGE.composedAt },
    ] as const;
    const inputs = [
      { scope: "project", readVersion: 2, currentVersion: 2 },
      { scope: "task:other", readVersion: 3, currentVersion: 4 },
      { scope: "task:deleted", readVersion: 1, currentVersion: null },
    ];
    const shown = handoffPresentation({ ...PACKAGE, overlaps, inputs });

    expect(shown.openOverlaps).toEqual(overlaps.slice(1));
    expect(shown.changedInputs).toEqual(inputs.slice(1));
  });

  it("does not invent missing results or next steps and ignores empty sections", () => {
    const shown = handoffPresentation({
      ...PACKAGE,
      context: {
        version: 1,
        updatedAt: PACKAGE.composedAt,
        gist: null,
        sections: [{ name: "Blockers", shortened: false, lines: [" ", "- "] }],
        projectLines: [],
      },
    });

    expect(shown.sections).toEqual([]);
    expect(shown.result).toBeUndefined();
    expect(shown.next).toBeUndefined();
    expect(shown.blockers).toBeUndefined();
  });

  it("links only distinct, valid GitHub pull requests", () => {
    const url = "https://github.com/acme/app/pull/12";
    const shown = handoffPresentation({
      ...PACKAGE,
      pullRequests: [url, "javascript:alert(1)", url, "https://example.test/pull/2"],
    });

    expect(shown.pulls).toEqual([url]);
  });
});
