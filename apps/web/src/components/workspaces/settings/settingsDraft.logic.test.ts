import { describe, expect, it } from "vite-plus/test";

import {
  changesBetween,
  changesText,
  countChanges,
  draftSets,
  edit,
  isStale,
  landed,
  standing,
  unsaved,
  type DraftState,
  type Live,
} from "./settingsDraft.logic";

const booking = (overrides: Record<string, unknown> = {}) => ({
  name: "Booking",
  members: ["slavo@acme.dev", "eva@acme.dev"],
  leads: ["slavo@acme.dev"],
  areas: ["Web", "API"],
  repositories: [
    { id: "app", url: "https://github.com/acme/app", branch: "main" },
    { id: "api", url: "https://github.com/acme/api", branch: "main" },
  ],
  tools: ["jira", { tool: "postgres", env: { DB: "staging" } }],
  coordination: { policy: "notify", paths: { "docs/**": "notify" } },
  capacity: {
    personal: "any",
    shared: { pool: "main", budget: { amount: 600 }, allocations: { "eva@acme.dev": 150 } },
  },
  ...overrides,
});

const documentOf = (project: Record<string, unknown> = booking()) => ({
  currency: "EUR",
  projects: { booking: project },
  capacity: {
    main: { name: "Main", models: [{ id: "sonnet", provider: "anthropic", harness: ["claude"] }] },
  },
});

const base = documentOf();
const slice = ["projects", "booking"] as const;

describe("counting what changed", () => {
  it("counts nothing for a document that is the same, however its keys are ordered", () => {
    expect(countChanges(base, documentOf(), slice)).toBe(0);
    expect(
      countChanges(
        { projects: { booking: { b: 1, a: 2 } } },
        { projects: { booking: { a: 2, b: 1 } } },
        slice,
      ),
    ).toBe(0);
  });

  it("counts a changed scalar once, wherever it is", () => {
    const draft = documentOf(
      booking({ coordination: { policy: "coordinate", paths: { "docs/**": "notify" } } }),
    );
    expect(changesBetween(base, draft, slice)).toEqual([
      { path: ["projects", "booking", "coordination", "policy"], leaves: 1 },
    ]);
  });

  it("counts people added to or taken from a set one by one", () => {
    const draft = documentOf(
      booking({ members: ["slavo@acme.dev", "ana@acme.dev", "bob@acme.dev"] }),
    );
    // eva out, ana and bob in
    expect(changesBetween(base, draft, slice)).toEqual([
      { path: ["projects", "booking", "members"], leaves: 3 },
    ]);
  });

  it("does not count a set that holds the same people in another order", () => {
    const draft = documentOf(booking({ members: ["eva@acme.dev", "slavo@acme.dev"] }));
    expect(countChanges(base, draft, slice)).toBe(0);
  });

  it("counts switching between the whole workspace and named people as one change", () => {
    const toAll = documentOf(booking({ members: ["*"] }));
    expect(changesBetween(base, toAll, slice)).toEqual([
      { path: ["projects", "booking", "members"], leaves: 1 },
    ]);
    expect(countChanges(toAll, base, slice)).toBe(1);
  });

  it("counts the elements of a keyed list that changed, at the list", () => {
    const draft = documentOf(
      booking({
        repositories: [
          { id: "app", url: "https://github.com/acme/app", branch: "release/2026" },
          { id: "web", url: "https://github.com/acme/web", branch: "main" },
        ],
      }),
    );
    // app's branch changed, api removed, web added
    expect(changesBetween(base, draft, slice)).toEqual([
      { path: ["projects", "booking", "repositories"], leaves: 3 },
    ]);
  });

  it("keys a project's tools by tool id, a bare string being its own id", () => {
    const added = documentOf(
      booking({ tools: ["jira", { tool: "postgres", env: { DB: "staging" } }, "sentry"] }),
    );
    expect(changesBetween(base, added, slice)).toEqual([
      { path: ["projects", "booking", "tools"], leaves: 1 },
    ]);
    const reordered = documentOf(
      booking({ tools: [{ tool: "postgres", env: { DB: "staging" } }, "jira"] }),
    );
    expect(countChanges(base, reordered, slice)).toBe(0);
    const env = documentOf(booking({ tools: ["jira", { tool: "postgres", env: { DB: "prod" } }] }));
    expect(countChanges(base, env, slice)).toBe(1);
  });

  it("counts a path rule added or removed one by one, at the rule", () => {
    const draft = documentOf(
      booking({
        coordination: { policy: "notify", paths: { "migrations/**": "exclusive" } },
      }),
    );
    expect(changesBetween(base, draft, slice).map((change) => change.path.slice(-1)[0])).toEqual([
      "docs/**",
      "migrations/**",
    ]);
  });

  it("counts a list that is one value once, however much of it changed", () => {
    const draft = documentOf(booking({ areas: ["API", "Web", "Mobile"] }));
    expect(changesBetween(base, draft, slice)).toEqual([
      { path: ["projects", "booking", "areas"], leaves: 1 },
    ]);
  });

  it("counts a node that appears or disappears as one change, not one for each of its parts", () => {
    const without = documentOf(booking({ coordination: undefined }));
    const gone = changesBetween(base, without, slice);
    expect(gone).toEqual([{ path: ["projects", "booking", "coordination"], leaves: 1 }]);
    expect(countChanges({ projects: {} }, base, ["projects", "booking"])).toBe(1);
  });

  it("only counts below the slice", () => {
    const draft = { ...documentOf(), currency: "USD" };
    expect(countChanges(base, draft, slice)).toBe(0);
    expect(countChanges(base, draft)).toBe(1);
  });

  it("counts a model's harnesses as a set inside the pool's keyed list", () => {
    const draft = {
      ...documentOf(),
      capacity: {
        main: {
          name: "Main",
          models: [{ id: "sonnet", provider: "anthropic", harness: ["claude", "codex"] }],
        },
      },
    };
    expect(changesBetween(base, draft, ["capacity"])).toEqual([
      { path: ["capacity", "main", "models"], leaves: 1 },
    ]);
  });
});

describe("the sets that save a draft", () => {
  it("sends each change at its node, and a list whole", () => {
    const draft = documentOf(
      booking({
        coordination: {
          policy: "coordinate",
          paths: { "docs/**": "notify", "migrations/**": "exclusive" },
        },
        members: ["slavo@acme.dev", "eva@acme.dev", "ana@acme.dev"],
      }),
    );
    expect(draftSets(base, draft, slice)).toEqual([
      {
        path: ["projects", "booking", "members"],
        value: ["slavo@acme.dev", "eva@acme.dev", "ana@acme.dev"],
      },
      { path: ["projects", "booking", "coordination", "policy"], value: "coordinate" },
      {
        path: ["projects", "booking", "coordination", "paths", "migrations/**"],
        value: "exclusive",
      },
    ]);
  });

  it("removes a node by setting it to null", () => {
    const draft = documentOf(booking({ coordination: { policy: "notify", paths: {} } }));
    expect(draftSets(base, draft, slice)).toEqual([
      { path: ["projects", "booking", "coordination", "paths", "docs/**"], value: null },
    ]);
  });

  it("sends a coarser node whole when the page names it, once, whatever changed beneath it", () => {
    const draft = documentOf(
      booking({ coordination: { policy: "coordinate", paths: { "docs/**": "ask" } } }),
    );
    const coordination = ["projects", "booking", "coordination"];
    expect(draftSets(base, draft, slice, [coordination])).toEqual([
      {
        path: coordination,
        value: { policy: "coordinate", paths: { "docs/**": "ask" } },
      },
    ]);
  });

  it("sends nothing for a draft that changed nothing", () => {
    expect(draftSets(base, documentOf(), slice)).toEqual([]);
  });
});

describe("a draft over time", () => {
  const key = "acme\u0000projects\u0000booking";
  const live = (revision: number, project = booking()): Live => ({
    revision,
    document: documentOf(project),
  });
  const editPolicy = (state: DraftState | null, at: Live | null, value: unknown, where = key) =>
    edit(state, where, at, slice, ["coordination", "policy"], value);

  it("starts from the view at its revision and keeps that as its base", () => {
    const started = editPolicy(null, live(41), "coordinate");
    expect(started?.revision).toBe(41);
    expect(started?.base).toEqual(live(41).document);
    expect(unsaved(started, slice)).toBe(1);
  });

  it("is not stale for a save somewhere else: a revision is the whole workspace's", () => {
    const started = editPolicy(null, live(41), "coordinate");
    const elsewhere = { revision: 42, document: { ...documentOf(), currency: "USD" } };
    expect(isStale(started, elsewhere, slice)).toBe(false);
    // The same save is a change to a draft of the whole document.
    expect(isStale(started, elsewhere)).toBe(true);
  });

  it("is clean again, and follows the view, once its changes are undone", () => {
    const started = editPolicy(null, live(41), "coordinate");
    expect(editPolicy(started, live(41), "notify")).toBeNull();
  });

  it("stays on its base while the view moves on, and says the settings changed", () => {
    const started = editPolicy(null, live(41), "coordinate");
    expect(isStale(started, live(41), slice)).toBe(false);
    expect(isStale(started, live(42, booking({ areas: ["Web"] })), slice)).toBe(true);
    // Another change on top keeps the base it had.
    const more = edit(started, key, live(42), slice, ["coordination", "paths", "a/**"], "ask");
    expect(more?.revision).toBe(41);
    expect(unsaved(more, slice)).toBe(2);
  });

  it("cannot be started before there is a view, and a draft of another page is not this one's", () => {
    expect(editPolicy(null, null, "ask")).toBeNull();
    const started = editPolicy(null, live(41), "coordinate");
    const other = "acme\u0000projects\u0000camp-bot";
    expect(standing(started, other, live(41))).toBeNull();
    // Editing the other page starts from the view, not from what the first page changed.
    const fresh = editPolicy(started, live(41), "ask", other);
    expect(fresh?.key).toBe(other);
    expect(unsaved(fresh, slice)).toBe(1);
  });

  it("stands in for the revision it became until the view reaches it", () => {
    const started = editPolicy(null, live(41), "coordinate");
    const saved = landed(started, 43);
    expect(unsaved(saved, slice)).toBe(0);
    expect(standing(saved, key, live(42))).toBe(saved);
    expect(isStale(saved, live(44, booking({ areas: ["Web"] })), slice)).toBe(false);
    expect(standing(saved, key, live(43))).toBeNull();
    expect(standing(saved, key, live(44))).toBeNull();
  });

  it("edits on top of what a save made, not on what it started from", () => {
    const saved = landed(editPolicy(null, live(41), "coordinate"), 43);
    const again = editPolicy(saved, live(42), "ask");
    expect(again?.revision).toBe(43);
    expect(again?.landed).toBeNull();
    expect(unsaved(again, slice)).toBe(1);
  });

  it("forgets a draft whose save came back without a revision", () => {
    expect(landed(editPolicy(null, live(41), "coordinate"), undefined)).toBeNull();
  });
});

describe("the bar's words", () => {
  it.each<[number, string | undefined, string]>([
    [1, "Booking · People", "1 unsaved change to Booking · People"],
    [3, "Booking · People", "3 unsaved changes to Booking · People"],
    [2, undefined, "2 unsaved changes"],
    [1, "", "1 unsaved change"],
  ])("%d changes to %j reads %j", (count, scope, text) => {
    expect(changesText(count, scope)).toBe(text);
  });
});
