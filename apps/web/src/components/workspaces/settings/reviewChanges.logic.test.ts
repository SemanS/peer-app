import type {
  PeerSettingsChangeResult,
  PeerSettingsConflict,
  PeerSettingsLine,
  PeerSettingsPreview,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  NO_SETTLE,
  agoText,
  appliesText,
  applySets,
  changeCall,
  checkNotes,
  conflictIntro,
  conflictKey,
  conflictTitle,
  countInWords,
  defaultChoices,
  diagnosticTone,
  discardMine,
  gatewayNote,
  isNoop,
  joinNames,
  latestTheirs,
  lineKeys,
  lineSummary,
  lineWhere,
  mergedNote,
  mergeSettle,
  noopText,
  otherChangeText,
  refusalText,
  related,
  reviewWords,
  saveLabel,
  savedTitle,
  scopeNameOf,
  settlement,
  stepFor,
  theirNames,
  theirOtherLines,
  toolApprovalNotes,
  untouchedCount,
  type ReviewOperation,
} from "./reviewChanges.logic";

const line = (
  path: ReadonlyArray<string>,
  label: string,
  from: string,
  to: string,
  scope = { kind: "project", id: "booking", name: "Booking" },
): PeerSettingsLine => ({ path, scope, label, from, to });

const policy = line(
  ["projects", "booking", "coordination", "policy"],
  "Coordination",
  "notify",
  "coordinate",
);
const rule = line(
  ["projects", "booking", "coordination", "paths", "migrations/**"],
  "Path rule",
  "none",
  "migrations/** exclusive",
);
const sentry = line(["projects", "booking", "tools"], "Tools", "none", "Sentry added");

const person = { email: "slavo@acme.dev", name: "Slavo" };
const eva = { email: "eva@acme.dev", name: "Eva" };
const preview = (extra: Partial<PeerSettingsPreview> = {}): PeerSettingsPreview => ({
  base: 41,
  head: { seq: 41, by: person, at: "2026-10-11T12:00:00Z" },
  lines: [policy, rule, sentry],
  conflicts: [],
  diagnostics: [],
  applies: [],
  noop: false,
  ...extra,
});
const conflictAt = (
  path: ReadonlyArray<string>,
  extra: Partial<PeerSettingsConflict> = {},
): PeerSettingsConflict => ({
  path,
  label: "Path rule · migrations/**",
  base: null,
  mine: "exclusive",
  theirs: "coordinate",
  baseText: "none",
  mineText: "exclusive",
  theirsText: "coordinate",
  theirsBy: eva,
  theirsAt: "2026-10-11T12:02:00Z",
  theirsSeq: 42,
  ...extra,
});
const migrations = conflictAt(["projects", "booking", "coordination", "paths", "migrations/**"]);

describe("the call a review makes", () => {
  const save: ReviewOperation = {
    kind: "save",
    workspace: "acme",
    base: 41,
    set: [{ path: ["projects", "booking", "coordination", "policy"], value: "coordinate" }],
  };

  it("previews a draft's changes with the preview command and saves them with the save command", () => {
    expect(changeCall(save, "preview", { message: "", settle: NO_SETTLE })).toEqual({
      command: "preview",
      input: { workspace: "acme", base: 41, set: save.set },
    });
    expect(
      changeCall(save, "save", { message: "  Two agents broke it  ", settle: NO_SETTLE }),
    ).toEqual({
      command: "save",
      input: { workspace: "acme", base: 41, set: save.set, message: "Two agents broke it" },
    });
  });

  it("sends how conflicts were settled with both, so the preview shows what the save will do", () => {
    const settle = { force: [["a"]], drop: [["b"], ["c"]] };
    for (const mode of ["preview", "save"] as const) {
      const call = changeCall(save, mode, { message: "", settle });
      expect(call.input).toMatchObject({ force: [["a"]], drop: [["b"], ["c"]] });
    }
  });

  it("previews a revert, an import and an applied proposal as dry runs of the commands that save them", () => {
    expect(
      changeCall({ kind: "revert", workspace: "acme", seq: 43 }, "preview", {
        message: "",
        settle: NO_SETTLE,
      }),
    ).toEqual({ command: "revert", input: { workspace: "acme", seq: 43, dryRun: true } });
    expect(
      changeCall({ kind: "revert", workspace: "acme", seq: 43 }, "save", {
        message: "Back",
        settle: NO_SETTLE,
      }),
    ).toEqual({ command: "revert", input: { workspace: "acme", seq: 43, message: "Back" } });
    expect(
      changeCall(
        { kind: "import", workspace: "acme", files: { "workspace.yaml": "x" } },
        "preview",
        {
          message: "",
          settle: NO_SETTLE,
        },
      ),
    ).toEqual({
      command: "importYaml",
      input: { workspace: "acme", files: { "workspace.yaml": "x" }, dryRun: true },
    });
    expect(
      changeCall({ kind: "import", workspace: "acme", files: {}, base: 40 }, "save", {
        message: "",
        settle: NO_SETTLE,
      }),
    ).toEqual({ command: "importYaml", input: { workspace: "acme", files: {}, base: 40 } });
    expect(
      changeCall({ kind: "proposal", workspace: "acme", id: "p_1" }, "preview", {
        message: "",
        settle: NO_SETTLE,
      }),
    ).toEqual({ command: "applyProposal", input: { workspace: "acme", id: "p_1", dryRun: true } });
  });
});

describe("where an answer leads", () => {
  const as = (result: object) => result as PeerSettingsChangeResult;

  it("shows the review for a dry run, the saved view for a save", () => {
    expect(stepFor(as({ kind: "preview", ...preview() })).kind).toBe("review");
    expect(stepFor(as({ kind: "saved", ...preview() })).kind).toBe("saved");
  });

  it("shows the conflict view whether the dry run lists conflicts or the save was refused for them", () => {
    expect(stepFor(as({ kind: "preview", ...preview({ conflicts: [migrations] }) })).kind).toBe(
      "conflict",
    );
    expect(stepFor(as({ kind: "conflict", ...preview({ conflicts: [migrations] }) })).kind).toBe(
      "conflict",
    );
  });

  it("carries a refusal's paths and a failed check's diagnostics", () => {
    const refused = [
      {
        path: ["projects", "booking", "capacity", "shared", "budget"],
        label: "Budget",
        owners: "admins",
      },
    ];
    expect(stepFor(as({ kind: "forbidden", refused }))).toEqual({ kind: "forbidden", refused });
    const diagnostics = [{ severity: "error", at: "projects.booking.leads", message: "no lead" }];
    expect(stepFor(as({ kind: "invalid", diagnostics }))).toEqual({ kind: "invalid", diagnostics });
  });

  it("calls a review with no lines, or one the Hub marks, nothing to save", () => {
    expect(isNoop(preview())).toBe(false);
    expect(isNoop(preview({ lines: [] }))).toBe(true);
    expect(isNoop(preview({ noop: true }))).toBe(true);
  });
});

describe("the review's words", () => {
  it.each<[number, string]>([
    [1, "Save 1 change"],
    [5, "Save 5 changes"],
  ])("labels the save button for %d", (count, label) => {
    expect(saveLabel(count)).toBe(label);
  });

  it("names what a line is about, with its scope when it is not the one under review", () => {
    expect(lineWhere(policy, "Booking")).toBe("Coordination");
    const catalog = line(["tools", "pg"], "Postgres staging", "v3", "v4", {
      kind: "workspace",
      id: "tools",
      name: "Tool catalog",
    });
    expect(lineWhere(catalog, "Booking")).toBe("Tool catalog · Postgres staging");
    expect(lineSummary(policy)).toBe("Booking · Coordination: notify → coordinate");
  });

  it("says what a review of several scopes is to", () => {
    const catalog = line(["tools", "pg"], "Postgres staging", "v3", "v4", {
      kind: "workspace",
      id: "tools",
      name: "Tool catalog",
    });
    expect(scopeNameOf([policy, rule], "Acme")).toBe("Booking");
    expect(scopeNameOf([policy, catalog], "Acme")).toBe("Booking and Tool catalog");
    expect(
      scopeNameOf(
        [
          policy,
          catalog,
          line(["gateway", "url"], "Address", "a", "b", {
            kind: "workspace",
            id: "gw",
            name: "Gateway",
          }),
        ],
        "Acme",
      ),
    ).toBe("3 places");
    expect(scopeNameOf([], "Acme")).toBe("Acme");
  });

  it("lists each wait once, on one line", () => {
    expect(
      appliesText([
        { kind: "next-edit", text: "Policy and path rules: from the next file edit" },
        { kind: "after-approval", text: "Sentry: after each person approves it" },
        { kind: "next-edit", text: "Policy and path rules: from the next file edit" },
      ]),
    ).toBe(
      "Policy and path rules: from the next file edit · Sentry: after each person approves it",
    );
  });

  it("saves under a title that says whether the gateway took it, and with its revision", () => {
    expect(savedTitle({ ...preview(), revision: { seq: 43, commit: "x", at: "y" } })).toBe(
      "Saved · revision 43",
    );
    expect(savedTitle(preview())).toBe("Saved");
    expect(gatewayNote(undefined)).toBeNull();
    expect(gatewayNote({ ok: true })).toEqual({ kind: "ok" });
    expect(gatewayNote({ error: "no answer in 10 s" })).toEqual({
      kind: "failed",
      error: "no answer in 10 s",
    });
    expect(gatewayNote({ ok: false })?.kind).toBe("failed");
  });

  it("says who may change what a refusal names", () => {
    expect(
      refusalText({ path: ["a"], label: "Budget", owners: "Booking's leads and admins" }),
    ).toBe("Only Booking's leads and admins can change Budget.");
  });

  it("applies a draft's sets to a document, a null removing the node", () => {
    expect(
      applySets({ a: { b: 1, c: 2 } }, [
        { path: ["a", "b"], value: 5 },
        { path: ["a", "c"], value: null },
        { path: ["d"], value: ["x"] },
      ]),
    ).toEqual({ a: { b: 5 }, d: ["x"] });
  });
});

describe("before you save", () => {
  const document = {
    projects: {
      booking: {
        name: "Booking",
        members: ["a@acme.dev", "b@acme.dev", "C@acme.dev"],
        leads: ["c@acme.dev", "d@acme.dev"],
        tools: ["jira", "sentry"],
      },
      everyone: {
        name: "Everyone",
        members: ["*"],
        tools: [{ tool: "postgres", env: { DB: "x" } }],
      },
      elsewhere: { name: "Elsewhere", members: ["x@acme.dev"], tools: ["postgres"] },
    },
  };
  const context = { document, workspacePeople: 14 };

  it("maps the check's severities: warnings amber, what it calls info blue", () => {
    expect(diagnosticTone("warning")).toBe("warning");
    expect(diagnosticTone("error")).toBe("warning");
    expect(diagnosticTone("info")).toBe("info");
  });

  it("tells a project's people that a tool added to it is new for them, counting its members and leads once", () => {
    const notes = toolApprovalNotes([sentry], [], context);
    expect(notes).toEqual([
      {
        tone: "info",
        text: "Sentry is new for 4 people. Each approves it on their own computer before their agents get it.",
      },
    ]);
  });

  it("counts the whole workspace for a project that takes everyone", () => {
    const added = line(["projects", "everyone", "tools"], "Tools", "none", "Sentry added");
    expect(toolApprovalNotes([added], [], context)[0]?.text).toContain(
      "Sentry is new for 14 people.",
    );
  });

  it("tells everyone whose project uses a catalog tool that it changes", () => {
    const changed = line(["tools", "postgres", "mcp"], "Postgres staging", "v3", "v4", {
      kind: "workspace",
      id: "tools",
      name: "Tool catalog",
    });
    const notes = toolApprovalNotes([changed, changed], [], context);
    expect(notes).toEqual([
      {
        tone: "info",
        text: "Postgres staging changes for 14 people. Each approves it again on their own computer before their agents get it.",
      },
    ]);
    const nobody = line(["tools", "unused"], "Unused", "v1", "v2");
    expect(toolApprovalNotes([nobody], [], context)).toEqual([]);
  });

  it("says nothing for a tool taken away, but falls back on the Hub's own word that approval is needed", () => {
    const removed = line(["projects", "booking", "tools"], "Tools", "Sentry", "Sentry removed");
    expect(toolApprovalNotes([removed], [], context)).toEqual([]);
    expect(
      toolApprovalNotes([removed], [{ kind: "after-approval", text: "x" }], context).map(
        (note) => note.text,
      ),
    ).toEqual([
      "Each person approves a new or changed tool on their own computer before their agents get it.",
    ]);
  });

  it("does not count a project the document lacks", () => {
    const added = line(["projects", "ghost", "tools"], "Tools", "none", "Sentry added");
    expect(toolApprovalNotes([added], [], context)[0]?.text).toBe(
      "Sentry is new. Each person approves it on their own computer before their agents get it.",
    );
  });

  it("puts the tool notes before what the check found", () => {
    const notes = checkNotes(
      preview({
        diagnostics: [
          {
            severity: "warning",
            at: "x",
            message: "Allocations add up to €630, over the €600 budget.",
          },
        ],
      }),
      context,
    );
    expect(notes.map((note) => note.tone)).toEqual(["info", "warning"]);
    expect(notes[1]?.text).toBe("Allocations add up to €630, over the €600 budget.");
  });
});

describe("when settings were saved after the changes started and nothing conflicts", () => {
  const now = Date.parse("2026-10-11T12:04:00Z");
  const at = "2026-10-11T12:02:00Z";

  it("says where the head is, who saved last, and that both stay, without claiming what they saved", () => {
    const merged = mergedNote(
      { base: 41, head: { seq: 42, by: eva, at }, conflicts: [] },
      { name: "Eva", now },
    );
    expect(merged).toEqual({
      tone: "info",
      text: "Settings were saved after revision 41: the latest, revision 42, by Eva 2 minutes ago. None of it conflicts with these changes, so both stay.",
    });
  });

  it("says nothing when the head is where the changes started, or when they conflict", () => {
    const input = { name: "Eva", now };
    expect(
      mergedNote({ base: 42, head: { seq: 42, by: eva, at }, conflicts: [] }, input),
    ).toBeNull();
    expect(
      mergedNote({ base: 41, head: { seq: 42, by: eva, at }, conflicts: [migrations] }, input),
    ).toBeNull();
  });
});

describe("what a review is of changes its words", () => {
  it("speaks of editing only for a draft", () => {
    expect(reviewWords("save")).toMatchObject({
      back: "Back to editing",
      mine: "Yours",
      discard: "Discard mine",
    });
    for (const kind of ["proposal", "revert", "import"] as const) {
      expect(reviewWords(kind).back).toBe("Cancel");
      expect(reviewWords(kind).discard).toBe("Keep theirs");
    }
    expect(reviewWords("proposal").mine).toBe("Proposed");
    expect(reviewWords("proposal").forbidden).toBe("Ask the people named to apply it.");
  });

  it("opens a proposal's conflict without calling it the owner's own", () => {
    expect(
      conflictIntro({
        kind: "proposal",
        base: 41,
        head: 42,
        scope: "Booking",
        names: ["Eva"],
        untouched: 2,
        conflicts: 1,
      }),
    ).toBe(
      "The proposal started from revision 41, Booking is now at 42. Two of the proposal’s changes don’t touch Eva’s. One does:",
    );
    expect(
      conflictIntro({
        kind: "revert",
        base: 41,
        head: 42,
        scope: "Booking",
        names: ["Eva"],
        untouched: 0,
        conflicts: 1,
      }),
    ).toBe(
      "The revert started from revision 41, Booking is now at 42. The revert’s change touches the same setting Eva changed:",
    );
  });

  it("says what a review left with nothing says, by whose changes were kept", () => {
    expect(noopText([])).toBe("Nothing would change: the settings already read this way.");
    expect(noopText(["Eva"])).toBe("Nothing left to save: the settings keep what Eva saved.");
    expect(noopText(["Eva", "Bob"])).toBe(
      "Nothing left to save: the settings keep what Eva and Bob saved.",
    );
  });
});

describe("what was decided across rounds of conflicts", () => {
  const a = ["projects", "booking", "a"];
  const b = ["projects", "booking", "b"];
  const c = ["projects", "booking", "c"];

  it("keeps the first round's decisions when a second round decides other paths", () => {
    expect(mergeSettle({ force: [], drop: [a] }, { force: [b], drop: [] })).toEqual({
      force: [b],
      drop: [a],
    });
  });

  it("takes the newer decision for a path decided again", () => {
    expect(mergeSettle({ force: [a], drop: [b] }, { force: [b], drop: [a] })).toEqual({
      force: [b],
      drop: [a],
    });
    expect(mergeSettle({ force: [a, c], drop: [] }, { force: [], drop: [] })).toEqual({
      force: [a, c],
      drop: [],
    });
    expect(mergeSettle(NO_SETTLE, NO_SETTLE)).toEqual(NO_SETTLE);
  });
});

describe("keys for lines", () => {
  it("tells apart lines that differ only in what they changed from, and lines that repeat exactly", () => {
    const first = line(["projects", "booking", "leads"], "People · Eva", "Member", "Lead");
    const second = line(["projects", "booking", "leads"], "People · Eva", "Lead", "Lead");
    const keys = lineKeys([first, second, first]).map(({ key }) => key);
    expect(new Set(keys).size).toBe(3);
    expect(lineKeys([first, second, first]).map(({ line: kept }) => kept)).toEqual([
      first,
      second,
      first,
    ]);
  });
});

describe("a conflict", () => {
  const docs = conflictAt(["projects", "booking", "coordination", "paths", "docs/**"], {
    label: "Path rule · docs/**",
  });

  it("starts on my value everywhere, and settles by what was picked", () => {
    const choices = defaultChoices([migrations, docs]);
    expect(choices).toEqual({
      [conflictKey(migrations.path)]: "mine",
      [conflictKey(docs.path)]: "mine",
    });
    expect(settlement([migrations, docs], choices)).toEqual({
      force: [migrations.path, docs.path],
      drop: [],
    });
    expect(
      settlement([migrations, docs], { ...choices, [conflictKey(docs.path)]: "theirs" }),
    ).toEqual({ force: [migrations.path], drop: [docs.path] });
    expect(settlement([migrations], {})).toEqual({ force: [migrations.path], drop: [] });
  });

  it("discards mine by dropping every conflicting path", () => {
    expect(discardMine([migrations, docs])).toEqual({
      force: [],
      drop: [migrations.path, docs.path],
    });
  });

  it("relates a path to what is above or below it", () => {
    expect(related(["a", "b"], ["a", "b"])).toBe(true);
    expect(related(["a"], ["a", "b"])).toBe(true);
    expect(related(["a", "b", "c"], ["a", "b"])).toBe(true);
    expect(related(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("counts my changes that touch nothing anyone saved", () => {
    expect(untouchedCount([policy, rule, sentry], [migrations])).toBe(2);
    // The Hub may list only the changes that do not conflict, or all of them.
    expect(untouchedCount([policy, sentry], [migrations])).toBe(2);
    expect(untouchedCount([rule], [migrations])).toBe(0);
  });

  it("names who saved once each, and the latest time", () => {
    const bob = conflictAt(["x"], {
      theirsBy: { email: "bob@acme.dev", name: "Bob" },
      theirsAt: "2026-10-11T12:05:00Z",
    });
    const evaAgain = conflictAt(["y"], { theirsBy: { email: "EVA@acme.dev", name: "Eva" } });
    expect(theirNames([migrations, bob, evaAgain], (who) => who.name)).toEqual(["Eva", "Bob"]);
    expect(latestTheirs([migrations, bob])).toBe("2026-10-11T12:05:00Z");
    expect(latestTheirs([])).toBeUndefined();
    expect(joinNames([])).toBe("");
    expect(joinNames(["Eva"])).toBe("Eva");
    expect(joinNames(["Eva", "Bob"])).toBe("Eva and Bob");
    expect(joinNames(["Eva", "Bob", "Ana"])).toBe("Eva, Bob and Ana");
  });

  it("says when they saved in words", () => {
    const at = "2026-10-11T12:02:00Z";
    const minutes = (n: number) => Date.parse(at) + n * 60_000;
    expect(agoText(at, minutes(0))).toBe("just now");
    expect(agoText(at, minutes(1))).toBe("1 minute ago");
    expect(agoText(at, minutes(2))).toBe("2 minutes ago");
    expect(agoText(at, minutes(60))).toBe("1 hour ago");
    expect(agoText(at, minutes(60 * 5))).toBe("5 hours ago");
    expect(agoText(at, minutes(60 * 24 * 2))).toBe("2 days ago");
    expect(agoText(at, minutes(-5))).toBe("just now");
    expect(agoText(undefined, 0)).toBe("meanwhile");
    expect(agoText("not a time", 0)).toBe("meanwhile");
    expect(conflictTitle(["Eva"], "Booking", "2 minutes ago")).toBe(
      "Eva saved Booking 2 minutes ago",
    );
  });

  it("opens as the design does: where I started, and how many of my changes touch theirs", () => {
    const base = { kind: "save" as const, base: 41, head: 42, scope: "Booking" };
    expect(conflictIntro({ ...base, names: ["Eva"], untouched: 4, conflicts: 1 })).toBe(
      "You started from revision 41, Booking is now at 42. Four of your changes don’t touch Eva’s. One does:",
    );
    expect(conflictIntro({ ...base, names: ["Eva", "Bob"], untouched: 1, conflicts: 2 })).toBe(
      "You started from revision 41, Booking is now at 42. One of your changes doesn’t touch theirs. Two do:",
    );
    expect(conflictIntro({ ...base, names: ["Eva"], untouched: 0, conflicts: 1 })).toBe(
      "You started from revision 41, Booking is now at 42. Your change touches the same setting Eva changed:",
    );
    expect(conflictIntro({ ...base, names: ["Eva", "Bob"], untouched: 0, conflicts: 3 })).toBe(
      "You started from revision 41, Booking is now at 42. Your 3 changes touch the same settings Eva and Bob changed:",
    );
    expect(countInWords(4)).toBe("four");
    expect(countInWords(12)).toBe("12");
  });

  it("keeps what else their revisions changed, apart from what I conflict with", () => {
    const theirOther = line(
      ["projects", "booking", "coordination", "paths", "docs/**"],
      "Path rule · docs/**",
      "notify",
      "none",
    );
    const lines = theirOtherLines(
      [
        {
          lines: [
            theirOther,
            line(migrations.path, "Path rule · migrations/**", "none", "coordinate"),
          ],
        },
      ],
      [migrations],
    );
    expect(lines).toEqual([theirOther]);
    expect(otherChangeText(["Eva"], lines)).toBe(
      "Eva’s other change stays: Path rule · docs/**: notify → none.",
    );
    expect(otherChangeText(["Eva", "Bob"], [theirOther, theirOther])).toBe(
      "Their other changes stay: Path rule · docs/**: notify → none; Path rule · docs/**: notify → none.",
    );
    expect(otherChangeText(["Eva"], [])).toBeNull();
  });
});
