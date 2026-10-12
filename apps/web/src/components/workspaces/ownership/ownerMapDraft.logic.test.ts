import { ownerName, projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import type { PeerOwnerMap } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addPath,
  canAddPath,
  canSave,
  changeCount,
  changeWords,
  draftMap,
  draftOf,
  editPath,
  footerText,
  mapChanges,
  patternProblem,
  rebase,
  removePath,
  rowNotes,
  rowProblems,
  saveInput,
  setAreaOwner,
  type OwnerMapDraft,
} from "./ownerMapDraft.logic";
import { ANA, BOB, CYRIL, EVA, statusFor } from "./ownership.testkit";

const AREAS = ["Orders", "Payments", "Menu"];
const IDS = { workspace: "acme", project: "ordering" };

/** Version 7: Eva owns Orders, Ana owns Payments and decides its paths, Menu has no owner yet. */
const V7: PeerOwnerMap = {
  version: 7,
  areas: { Orders: EVA, Payments: ANA },
  paths: { "src/payments/**": ANA, "src/orders/**": EVA, "src/menu/**": CYRIL },
  decide: ["src/payments/**"],
};

const ownership = (() => {
  const status = statusFor(EVA);
  const workspace = status.workspaces[0]!;
  return projectOwnership(status, workspace, workspace.projects[0]!.project)!;
})();
const name = (email: string) => ownerName(ownership, email);

const draft = (map: PeerOwnerMap = V7, areas: ReadonlyArray<string> = AREAS) => draftOf(map, areas);
const rowOf = (made: OwnerMapDraft, pattern: string) =>
  made.paths.find((row) => row.pattern === pattern)!;

describe("the draft of a saved map", () => {
  it("lists the project's areas in its order, then the ones the map holds that it no longer lists", () => {
    const made = draft({ ...V7, areas: { ...V7.areas, Billing: BOB } });
    expect(made.areas).toEqual([
      { area: "Orders", owner: EVA, stale: false },
      { area: "Payments", owner: ANA, stale: false },
      { area: "Menu", owner: null, stale: false },
      { area: "Billing", owner: BOB, stale: true },
    ]);
    expect(made.base.version).toBe(7);
  });

  it("lists the patterns alphabetically with who owns them and whether the owner decides", () => {
    expect(draft().paths.map(({ pattern, owner, decides }) => [pattern, owner, decides])).toEqual([
      ["src/menu/**", CYRIL, false],
      ["src/orders/**", EVA, false],
      ["src/payments/**", ANA, true],
    ]);
  });

  it("lists a pattern where the owner decides but that names no owner, as a row without one", () => {
    const made = draft({ ...V7, decide: ["src/payments/**", "src/ghost/**"] });
    expect(rowOf(made, "src/ghost/**")).toMatchObject({ owner: null, decides: true });
  });

  it("saves the map it was made from, unchanged, and changes nothing", () => {
    const made = draft();
    expect(draftMap(made)).toEqual({
      areas: { Orders: EVA, Payments: ANA },
      paths: { "src/payments/**": ANA, "src/orders/**": EVA, "src/menu/**": CYRIL },
      decide: ["src/payments/**"],
    });
    expect(changeCount(made)).toBe(0);
    expect(canSave(made)).toBe(false);
    expect(footerText(made)).toBe("No changes from version 7");
  });
});

describe("a lead assigns an area", () => {
  it("makes Cyril the owner of an area, in a save from the version the lead opened", () => {
    const made = setAreaOwner(draft(), "Menu", CYRIL);
    expect(saveInput(made, IDS)).toEqual({
      ...IDS,
      version: 7,
      areas: { Orders: EVA, Payments: ANA, Menu: CYRIL },
      paths: V7.paths,
      decide: V7.decide,
    });
    expect(changeCount(made)).toBe(1);
    expect(canSave(made)).toBe(true);
    expect(footerText(made)).toBe("1 change from version 7");
  });

  it("takes the owner off an area by choosing nobody", () => {
    const made = setAreaOwner(draft(), "Payments", null);
    expect(saveInput(made, IDS).areas).toEqual({ Orders: EVA });
    expect(
      mapChanges(made.base, draftMap(made)).map((change) => changeWords(change, name)),
    ).toEqual(["took the owner off the area Payments"]);
  });

  it("keeps an owner who left when the lead leaves them be, so the save names nobody new", () => {
    const left = draft({ ...V7, areas: { ...V7.areas, Payments: "dan@acme.test" } });
    expect(saveInput(left, IDS).areas.Payments).toBe("dan@acme.test");
    expect(changeCount(left)).toBe(0);
  });
});

describe("path patterns", () => {
  it("adds a row, edits it and removes it, and leaves a row with nothing in it out of a save", () => {
    let made = addPath(draft());
    const added = made.paths.at(-1)!;
    expect(added).toMatchObject({ pattern: "", owner: null, decides: false });
    // Nothing is in the row yet: it changes nothing and stops nothing.
    expect(changeCount(made)).toBe(0);
    expect(rowProblems(made).size).toBe(0);
    made = editPath(made, added.id, { pattern: " src/billing/** ", owner: BOB, decides: true });
    expect(draftMap(made)).toMatchObject({
      paths: { "src/billing/**": BOB },
      decide: ["src/billing/**", "src/payments/**"],
    });
    expect(changeCount(made)).toBe(1);
    made = removePath(made, added.id);
    expect(changeCount(made)).toBe(0);
  });

  it("counts taking a pattern out and changing its owner or who decides as one change each", () => {
    let made = removePath(draft(), rowOf(draft(), "src/menu/**").id);
    expect(mapChanges(made.base, draftMap(made)).map((c) => changeWords(c, name))).toEqual([
      "took src/menu/** off the owner map",
    ]);
    made = editPath(draft(), rowOf(draft(), "src/payments/**").id, { owner: BOB, decides: false });
    expect(changeCount(made)).toBe(1);
    expect(mapChanges(made.base, draftMap(made)).map((c) => changeWords(c, name))).toEqual([
      "made Bob owner of src/payments/** and took owner decides off src/payments/**",
    ]);
  });

  it("says in words what was added or changed", () => {
    const made = editPath(addPath(draft()), "p4", {
      pattern: "src/billing/**",
      owner: BOB,
      decides: true,
    });
    expect(mapChanges(made.base, draftMap(made)).map((c) => changeWords(c, name))).toEqual([
      "made Bob owner of src/billing/**, where the owner decides",
    ]);
    const bare = editPath(made, "p4", { owner: null });
    expect(mapChanges(bare.base, draftMap(bare)).map((c) => changeWords(c, name))).toEqual([
      "set src/billing/** to owner decides",
    ]);
  });

  it("holds at most 50 patterns", () => {
    let made = draft({ version: 1, areas: {}, paths: {}, decide: [] });
    for (let index = 0; index < 60; index += 1) made = addPath(made);
    expect(made.paths).toHaveLength(50);
    expect(canAddPath(made)).toBe(false);
    expect(canAddPath(draft())).toBe(true);
  });
});

describe("what the Hub would refuse", () => {
  it("names what patterns do not take, and a pattern to try", () => {
    expect(patternProblem("src/payments/[a-z]*.ts")).toBe(
      "Patterns use /, * and ** only: [ ] is not allowed. Try src/payments/*.ts.",
    );
    expect(patternProblem("src/pay?ments/**")).toBe(
      "Patterns use /, * and ** only: ? is not allowed. Try src/pay*ments/**.",
    );
    expect(patternProblem("src/{a,b}/**")).toBe(
      "Patterns use /, * and ** only: { } is not allowed. Try src/*/**.",
    );
    expect(patternProblem("src/a[?]/**")).toBe(
      "Patterns use /, * and ** only: [ ? ] are not allowed. Try src/a*/**.",
    );
  });

  it("gives the Hub's own words for the other refusals, and nothing for a pattern it takes", () => {
    expect(patternProblem("/src/**")).toBe(
      "A pattern is relative to the repository: no leading `/`.",
    );
    expect(patternProblem("src//a")).toBe("A pattern has no empty segment (`//`).");
    expect(patternProblem("src/a**b")).toBe("`**` is a whole segment (`a/**/b`), not part of one.");
    expect(patternProblem("src/payments/**")).toBeNull();
    expect(patternProblem("*.ts")).toBeNull();
  });

  it("stops a row whose pattern is refused, listed twice or without an owner", () => {
    let made = draft();
    made = editPath(addPath(made), "p4", { pattern: "src/a/[x]", owner: BOB });
    made = editPath(addPath(made), "p5", { pattern: "src/menu/**", owner: BOB });
    made = editPath(addPath(made), "p6", { pattern: "src/new/**" });
    made = editPath(addPath(made), "p7", { owner: BOB });
    expect(Object.fromEntries(rowProblems(made))).toEqual({
      p4: "Patterns use /, * and ** only: [ ] is not allowed. Try src/a/*.",
      p5: "src/menu/** is already listed above.",
      p6: "Choose an owner.",
      p7: "Type a pattern, or remove the row.",
    });
    expect(canSave(made)).toBe(false);
  });

  it("says in the bar how many changes there are and how many patterns need fixing", () => {
    let made = setAreaOwner(draft(), "Menu", CYRIL);
    made = editPath(addPath(made), "p4", { pattern: "src/payments/refunds/**", owner: BOB });
    made = editPath(addPath(made), "p5", {
      pattern: "src/payments/[a-z]*.ts",
      owner: ANA,
      decides: true,
    });
    expect(changeCount(made)).toBe(3);
    expect(footerText(made)).toBe("3 changes from version 7 · 1 pattern needs fixing");
    expect(canSave(made)).toBe(false);
    made = removePath(made, "p5");
    expect(footerText(made)).toBe("2 changes from version 7");
    expect(canSave(made)).toBe(true);
    made = editPath(addPath(made), "p6", { pattern: "[" });
    made = editPath(addPath(made), "p7", { pattern: "]" });
    expect(footerText(made)).toBe("2 changes from version 7 · 2 patterns need fixing");
  });
});

describe("what an edit does to who decides", () => {
  const notes = (made: OwnerMapDraft) => Object.fromEntries(rowNotes(made, ownership));

  it("says a more specific pattern takes paths from a wider one, and that its owner no longer decides them", () => {
    const made = editPath(addPath(draft()), "p4", {
      pattern: "src/payments/refunds/**",
      owner: BOB,
    });
    expect(notes(made)).toEqual({
      p4: "More specific than src/payments/**: refunds become Bob’s, and Ana no longer decides them.",
    });
  });

  it("says who decides there when the new pattern is the one where the owner decides", () => {
    const made = editPath(addPath(draft()), "p4", {
      pattern: "src/orders/secret/**",
      owner: BOB,
      decides: true,
    });
    expect(notes(made)).toEqual({
      p4: "More specific than src/orders/**: secret become Bob’s, and Bob decides changes by others there.",
    });
  });

  it("says paths matching a pattern with no name of its own, and that they stay with the same owner", () => {
    const made = editPath(addPath(draft()), "p4", { pattern: "src/payments/*.ts", owner: ANA });
    expect(notes(made)).toEqual({
      p4: "More specific than src/payments/**: paths matching it stay Ana’s, and Ana no longer decides them.",
    });
  });

  it("says one file in the singular", () => {
    const made = editPath(addPath(draft()), "p4", { pattern: "src/payments/fees.ts", owner: BOB });
    expect(notes(made)).toEqual({
      p4: "More specific than src/payments/**: fees.ts becomes Bob’s, and Ana no longer decides it.",
    });
  });

  it("says nothing where an edit changes neither who owns nor who decides, or of what is as saved", () => {
    expect(notes(draft())).toEqual({});
    const same = editPath(addPath(draft()), "p4", {
      pattern: "src/payments/fees/**",
      owner: ANA,
      decides: true,
    });
    expect(notes(same)).toEqual({});
  });

  it("says nothing of a pattern the Hub would refuse, and of one that is no more specific", () => {
    const refused = editPath(addPath(draft()), "p4", {
      pattern: "src/payments/[x]/**",
      owner: BOB,
    });
    expect(notes(refused)).toEqual({});
    const wider = editPath(addPath(draft()), "p4", { pattern: "src/**", owner: BOB });
    expect(notes(wider)).toEqual({});
  });
});

describe("a save that lost to another", () => {
  /** Petra, an admin, saved version 8 meanwhile: Cyril owns src/menu/** and the area Menu is Bob's. */
  const V8: PeerOwnerMap = {
    ...V7,
    version: 8,
    areas: { ...V7.areas, Menu: BOB },
    paths: { ...V7.paths, "src/menu/**": EVA },
    updatedBy: BOB,
  };

  /** The lead's three edits on version 7. */
  const edited = () => {
    let made = setAreaOwner(draft(), "Menu", CYRIL);
    made = editPath(addPath(made), "p4", { pattern: "src/payments/refunds/**", owner: BOB });
    return editPath(addPath(made), "p5", {
      pattern: "src/payments/[a-z]*.ts",
      owner: ANA,
      decides: true,
    });
  };

  it("keeps every edit and takes what the other save changed in the rest", () => {
    const merged = rebase(edited(), V8, AREAS);
    expect(merged.base.version).toBe(8);
    // The area the lead set stays theirs, over Bob's; src/menu/** they left alone follows version 8.
    expect(merged.areas.find((row) => row.area === "Menu")?.owner).toBe(CYRIL);
    expect(rowOf(merged, "src/menu/**").owner).toBe(EVA);
    expect(rowOf(merged, "src/payments/refunds/**")).toMatchObject({ owner: BOB, decides: false });
    expect(rowOf(merged, "src/payments/[a-z]*.ts")).toMatchObject({ owner: ANA, decides: true });
    expect(changeCount(merged)).toBe(3);
    expect(footerText(merged)).toBe("3 changes from version 8 · 1 pattern needs fixing");
  });

  it("saves the merge from the new version, so saving again undoes nothing of the other save", () => {
    let merged = rebase(edited(), V8, AREAS);
    merged = removePath(merged, rowOf(merged, "src/payments/[a-z]*.ts").id);
    expect(saveInput(merged, IDS)).toEqual({
      ...IDS,
      version: 8,
      areas: { Orders: EVA, Payments: ANA, Menu: CYRIL },
      paths: { ...V7.paths, "src/menu/**": EVA, "src/payments/refunds/**": BOB },
      decide: ["src/payments/**"],
    });
  });

  it("says in words what the other save changed, and what the draft changes on top of it", () => {
    expect(mapChanges(V7, V8).map((change) => changeWords(change, name))).toEqual([
      "made Bob owner of the area Menu",
      "made Eva owner of src/menu/**",
    ]);
    const merged = rebase(edited(), V8, AREAS);
    expect(
      mapChanges(merged.base, draftMap(merged)).map((change) => changeWords(change, name)),
    ).toEqual([
      "made Cyril owner of the area Menu",
      "made Ana owner of src/payments/[a-z]*.ts, where the owner decides",
      "made Bob owner of src/payments/refunds/**",
    ]);
  });

  it("drops a pattern the other save took out when the lead left it alone, and adds one it added", () => {
    const theirs: PeerOwnerMap = {
      ...V7,
      version: 8,
      paths: { "src/payments/**": ANA, "src/orders/**": EVA, "src/billing/**": BOB },
    };
    const merged = rebase(setAreaOwner(draft(), "Menu", CYRIL), theirs, AREAS);
    expect(merged.paths.map((row) => row.pattern)).toEqual([
      "src/orders/**",
      "src/payments/**",
      "src/billing/**",
    ]);
    expect(rowOf(merged, "src/billing/**")).toMatchObject({ owner: BOB, decides: false });
    expect(changeCount(merged)).toBe(1);
  });

  it("keeps a pattern the lead took out taken out, and the lead's pattern where the other save added the same", () => {
    const theirs: PeerOwnerMap = {
      ...V7,
      version: 8,
      paths: { ...V7.paths, "src/menu/**": BOB, "src/billing/**": BOB },
    };
    let made = removePath(draft(), rowOf(draft(), "src/menu/**").id);
    made = editPath(addPath(made), "p4", { pattern: "src/billing/**", owner: CYRIL });
    const merged = rebase(made, theirs, AREAS);
    expect(merged.paths.map((row) => row.pattern)).not.toContain("src/menu/**");
    expect(merged.paths.filter((row) => row.pattern === "src/billing/**")).toHaveLength(1);
    expect(rowOf(merged, "src/billing/**").owner).toBe(CYRIL);
  });

  it("counts an edit the other save made too as no change any more", () => {
    const merged = rebase(
      setAreaOwner(draft(), "Menu", CYRIL),
      {
        ...V7,
        version: 8,
        areas: { ...V7.areas, Menu: CYRIL },
      },
      AREAS,
    );
    expect(changeCount(merged)).toBe(0);
  });

  it("follows the project's areas when they changed meanwhile", () => {
    const merged = rebase(draft(), { ...V7, version: 8, areas: { ...V7.areas, Billing: BOB } }, [
      ...AREAS,
      "Support",
    ]);
    expect(merged.areas.map((row) => [row.area, row.owner, row.stale])).toEqual([
      ["Orders", EVA, false],
      ["Payments", ANA, false],
      ["Menu", null, false],
      ["Support", null, false],
      ["Billing", BOB, true],
    ]);
  });
});
