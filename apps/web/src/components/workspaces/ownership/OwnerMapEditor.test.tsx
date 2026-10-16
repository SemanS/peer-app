import { projectOwnership, type ProjectOwnership } from "@t3tools/client-runtime/peer/ownership";
import { PeerHubError, type PeerOwnerMap } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerOwnership: { setMap: null } },
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.command }));

import { OwnerMapEditor } from "./OwnerMapEditor";
import { ANA, BOB, CYRIL, ENV, EVA, NOW, statusFor, type Looking } from "./ownership.testkit";
import { ownerMapSummary } from "./team.logic";

const AREAS = ["Payments", "Menu"];

/** Version 3 of ordering's map: Ana owns Payments and decides src/payments/**, Eva owns src/menu/**. */
const V3: PeerOwnerMap = {
  version: 3,
  areas: { Payments: ANA },
  paths: { "src/payments/**": ANA, "src/menu/**": EVA },
  decide: ["src/payments/**"],
  updatedBy: EVA,
  updatedAt: new Date(NOW - 3_600_000).toISOString(),
};

let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance | ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function ownershipOf(email: string, looking: Looking = {}): ProjectOwnership {
  const status = statusFor(email, { ...looking, ownership: { map: V3, ...looking.ownership } });
  const workspace = status.workspaces[0]!;
  return projectOwnership(status, workspace, workspace.projects[0]!.project)!;
}

const element = (ownership: ProjectOwnership) => (
  <OwnerMapEditor
    environmentId={ENV}
    ownership={ownership}
    areas={AREAS}
    summary={ownerMapSummary({ ownership, areas: AREAS, now: NOW })}
  />
);

async function show(email: string, looking: Looking = {}) {
  await act(async () => {
    renderer = create(element(ownershipOf(email, looking)));
  });
}

const buttons = () => renderer!.root.findAllByType("button");
const button = (label: string) => buttons().find((candidate) => words(candidate) === label);
/** The picker whose trigger is named `label`: the Select above it takes the choice. */
function select(label: string): ReactTestInstance {
  let node: ReactTestInstance | null = renderer!.root.find(
    (candidate) => candidate.props["aria-label"] === label,
  );
  while (node !== null && typeof node.props.onValueChange !== "function") node = node.parent;
  if (node === null) throw new Error(`no picker named ${label}`);
  return node;
}
const pick = (label: string, value: string) =>
  act(async () => select(label).props.onValueChange(value));
/** The text fields of the patterns, in order. */
const patterns = () =>
  renderer!.root.findAll((node) => node.props["aria-label"] === "Pattern" && node.type === "input");
const type = (index: number, value: string) =>
  act(async () => patterns()[index]!.props.onChange({ target: { value } }));
const footer = () =>
  words(renderer!.root.findAll((node) => node.props.className?.includes?.("sticky"))[0]!);
const save = () => act(async () => button("Save owner map")!.props.onClick());
const ok = (map: PeerOwnerMap, changed = true) => ({
  _tag: "Success",
  value: { kind: "saved", map, changed },
});
const conflict = (map: PeerOwnerMap) => ({ _tag: "Success", value: { kind: "conflict", map } });
const refused = (detail: string, code?: string) =>
  AsyncResult.failure(
    Cause.fail(new PeerHubError({ detail, ...(code === undefined ? {} : { code }) })),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.command.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("a lead assigns an area", () => {
  it("makes Cyril the owner of the area Menu, from the version the lead opened, for the whole project", async () => {
    mocks.command.mockResolvedValue(
      ok({ ...V3, version: 4, areas: { ...V3.areas, Menu: CYRIL }, updatedBy: EVA }),
    );
    await show(EVA);
    expect(select("Owner of Menu").props.value).toBe("no-owner");
    expect(footer()).toContain("No changes from version 3");
    expect(button("Save owner map")?.props.disabled).toBe(true);

    await pick("Owner of Menu", CYRIL);
    expect(words(renderer!.root)).toContain("Your edit");
    expect(footer()).toContain("1 change from version 3");
    await save();
    expect(mocks.command).toHaveBeenCalledWith({
      environmentId: ENV,
      input: {
        workspace: "acme",
        project: "ordering",
        version: 3,
        areas: { Payments: ANA, Menu: CYRIL },
        paths: V3.paths,
        decide: V3.decide,
      },
    });
    // The Hub has it: the draft is the saved map, and the bar says so.
    expect(footer()).toContain("Saved as version 4.");
    expect(select("Owner of Menu").props.value).toBe(CYRIL);
    expect(words(renderer!.root)).not.toContain("Your edit");
  });

  it("takes the owner off an area by choosing nobody, and offers the project's members by name", async () => {
    await show(EVA);
    await pick("Owner of Payments", "no-owner");
    expect(footer()).toContain("1 change from version 3");
    const items = select("Owner of Payments").props.items as ReadonlyArray<{ label: string }>;
    expect(items.map((item) => item.label).slice(0, 5)).toEqual([
      "No owner",
      "Ana",
      "Bob",
      "Cyril",
      "Eva",
    ]);
  });

  it("lists an area the project no longer lists, which the map still holds, and says so", async () => {
    await show(EVA, { ownership: { map: { ...V3, areas: { ...V3.areas, Billing: BOB } } } });
    expect(words(renderer!.root)).toContain("Billing · not an area of this project any more");
    expect(select("Owner of Billing").props.value).toBe(BOB);
  });
});

describe("path patterns", () => {
  it("adds a pattern with an owner where the owner decides, and says what it does to the wider one", async () => {
    mocks.command.mockResolvedValue(ok({ ...V3, version: 4 }));
    await show(EVA);
    await act(async () => button("Add a path pattern")!.props.onClick());
    await type(2, "src/payments/refunds/**");
    await pick("Owner of src/payments/refunds/**", BOB);
    expect(words(renderer!.root)).toContain(
      "More specific than src/payments/**: refunds become Bob’s, and Ana no longer decides them.",
    );
    expect(footer()).toContain("1 change from version 3");
    await save();
    expect(mocks.command.mock.calls[0]![0].input.paths).toEqual({
      ...V3.paths,
      "src/payments/refunds/**": BOB,
    });
  });

  it("switches Owner decides on a pattern, and takes a pattern out", async () => {
    await show(EVA);
    // Row order is alphabetical: src/menu/** first, src/payments/** second.
    const decides = renderer!.root.findAll(
      (node) => typeof node.props.onCheckedChange === "function",
    );
    await act(async () => decides[0]!.props.onCheckedChange(true));
    expect(footer()).toContain("1 change from version 3");
    await act(async () => decides[0]!.props.onCheckedChange(false));
    expect(footer()).toContain("No changes from version 3");
    const remove = buttons().find(
      (candidate) => candidate.props["aria-label"] === "Remove pattern",
    );
    await act(async () => remove!.props.onClick());
    expect(footer()).toContain("1 change from version 3");
    expect(patterns()).toHaveLength(1);
  });

  it("says why a pattern is refused, in the row, and does not let the map be saved with it", async () => {
    await show(EVA);
    await act(async () => button("Add a path pattern")!.props.onClick());
    await type(2, "src/payments/[a-z]*.ts");
    await pick("Owner of src/payments/[a-z]*.ts", ANA);
    const alert = renderer!.root.findByProps({ role: "alert" });
    expect(words(alert)).toBe(
      "Patterns use /, * and ** only: [ ] is not allowed. Try src/payments/*.ts.",
    );
    expect(footer()).toContain("1 change from version 3 · 1 pattern needs fixing");
    expect(button("Save owner map")?.props.disabled).toBe(true);
    await save();
    expect(mocks.command).not.toHaveBeenCalled();
    await type(2, "src/payments/*.ts");
    expect(renderer!.root.findAllByProps({ role: "alert" })).toEqual([]);
    expect(button("Save owner map")?.props.disabled).toBe(false);
  });

  it("asks a new pattern for an owner, and has nobody chosen until the lead picks one", async () => {
    await show(EVA);
    await act(async () => button("Add a path pattern")!.props.onClick());
    expect(select("Owner of the new pattern").props.value).toBeNull();
    // The members, and no "No owner": a pattern is for someone.
    const items = select("Owner of the new pattern").props.items as ReadonlyArray<{
      label: string;
    }>;
    expect(items.map((item) => item.label)).toEqual(["Ana", "Bob", "Cyril", "Eva"]);
    await type(2, "src/new/**");
    await pick("Owner of src/new/**", CYRIL);
    expect(select("Owner of src/new/**").props.value).toBe(CYRIL);
  });

  it("leaves a row nothing was typed in out of the save", async () => {
    mocks.command.mockResolvedValue(ok(V3, false));
    await show(EVA);
    await act(async () => button("Add a path pattern")!.props.onClick());
    await pick("Owner of Menu", CYRIL);
    await save();
    expect(Object.keys(mocks.command.mock.calls[0]![0].input.paths)).toEqual([
      "src/menu/**",
      "src/payments/**",
    ]);
  });

  it("holds at most 50 patterns", async () => {
    await show(EVA);
    for (let index = 0; index < 60; index += 1) {
      const add = button("Add a path pattern")!;
      if (add.props.disabled === true) break;
      await act(async () => add.props.onClick());
    }
    expect(patterns()).toHaveLength(50);
    expect(button("Add a path pattern")?.props.disabled).toBe(true);
  });

  it("discards every edit, back to the saved map", async () => {
    await show(EVA);
    await pick("Owner of Menu", CYRIL);
    await act(async () => button("Add a path pattern")!.props.onClick());
    expect(footer()).toContain("1 change from version 3");
    await act(async () => button("Discard")!.props.onClick());
    expect(footer()).toContain("No changes from version 3");
    expect(patterns()).toHaveLength(2);
    expect(select("Owner of Menu").props.value).toBe("no-owner");
  });
});

describe("only leads and admins edit the owner map", () => {
  it("shows a member the same map as text, with nothing to change", async () => {
    await show(BOB);
    const said = words(renderer!.root);
    expect(said).toContain("Payments Ana");
    expect(said).toContain("Menu No owner");
    expect(said).toContain("src/payments/** Ana Owner decides");
    expect(said).toContain("src/menu/** Eva");
    expect(renderer!.root.findAllByType("input")).toEqual([]);
    expect(buttons()).toEqual([]);
    expect(
      renderer!.root.findAll((node) => typeof node.props.onValueChange === "function"),
    ).toEqual([]);
  });

  it("lets a workspace admin edit it who leads no project", async () => {
    await show(CYRIL, { workspace: "admin" });
    expect(button("Save owner map")).toBeDefined();
    expect(select("Owner of Menu")).toBeDefined();
  });

  it("lists a pattern that decides and names no owner, to a member as no owner", async () => {
    await show(BOB, { ownership: { map: { ...V3, decide: ["src/payments/**", "src/ghost/**"] } } });
    expect(words(renderer!.root)).toContain("src/ghost/** No owner Owner decides");
  });
});

describe("a save that lost to another", () => {
  /** Bob, a lead too, saved version 4 meanwhile: src/menu/** is Cyril's, and the area Menu Bob's. */
  const V4: PeerOwnerMap = {
    ...V3,
    version: 4,
    areas: { ...V3.areas, Menu: BOB },
    paths: { ...V3.paths, "src/menu/**": CYRIL },
    updatedBy: BOB,
  };
  const withThree = async () => {
    mocks.command.mockResolvedValueOnce(conflict(V4));
    await show(EVA, { ownership: { leads: [EVA, BOB] } });
    await pick("Owner of Menu", CYRIL);
    await act(async () => button("Add a path pattern")!.props.onClick());
    await type(2, "src/payments/refunds/**");
    await pick("Owner of src/payments/refunds/**", BOB);
    await act(async () => button("Add a path pattern")!.props.onClick());
    await type(3, "src/payments/[a-z]*.ts");
    await pick("Owner of src/payments/[a-z]*.ts", ANA);
    // The bad pattern would stop a save; take it back out, as the lead would.
    const remove = buttons().filter(
      (candidate) => candidate.props["aria-label"] === "Remove pattern",
    );
    await act(async () => remove[3]!.props.onClick());
  };

  it("shows who saved it and what they changed, and keeps the lead's edits below", async () => {
    await withThree();
    await save();
    const alert = words(renderer!.root.findByProps({ role: "alert" }));
    expect(alert).toContain("Bob, a lead, saved version 4 while you were editing");
    expect(alert).toContain("Bob made Bob owner of the area Menu and 1 more change.");
    expect(alert).toContain(
      "Your two edits are kept below; review them against version 4 and save again.",
    );
    expect(button("Compare with version 4")).toBeDefined();
    // The lead's choices stay: Cyril owns the area, the new pattern is Bob's.
    expect(select("Owner of Menu").props.value).toBe(CYRIL);
    expect(select("Owner of src/payments/refunds/**").props.value).toBe(BOB);
    expect(patterns()).toHaveLength(3);
    // What the lead left alone follows version 4: src/menu/** is Cyril's now.
    expect(select("Owner of src/menu/**").props.value).toBe(CYRIL);
    expect(footer()).toContain("2 changes from version 4");
  });

  it("saves the merge from version 4, so the other save is not undone", async () => {
    await withThree();
    await save();
    mocks.command.mockResolvedValueOnce(ok({ ...V4, version: 5 }));
    await save();
    expect(mocks.command).toHaveBeenCalledTimes(2);
    expect(mocks.command.mock.calls[1]![0].input).toEqual({
      workspace: "acme",
      project: "ordering",
      version: 4,
      areas: { Payments: ANA, Menu: CYRIL },
      paths: { ...V3.paths, "src/menu/**": CYRIL, "src/payments/refunds/**": BOB },
      decide: V3.decide,
    });
    expect(footer()).toContain("Saved as version 5.");
    expect(renderer!.root.findAllByProps({ role: "alert" })).toEqual([]);
  });

  it("compares the other save's changes with the lead's own on top of it", async () => {
    await withThree();
    await save();
    expect(words(renderer!.root)).not.toContain("Changed in version 4");
    await act(async () => button("Compare with version 4")!.props.onClick());
    const comparison = words(
      renderer!.root.findByProps({ "aria-label": "Comparison with version 4" }),
    );
    expect(comparison).toContain("Changed in version 4");
    expect(comparison).toContain("Bob made Bob owner of the area Menu");
    expect(comparison).toContain("Bob made Cyril the owner of src/menu/**");
    expect(comparison).toContain("Your edits on top of it");
    expect(comparison).toContain("You made Cyril owner of the area Menu");
    expect(comparison).toContain("You made Bob the owner of src/payments/refunds/**");
    await act(async () => button("Hide the comparison")!.props.onClick());
    expect(renderer!.root.findAllByProps({ "aria-label": "Comparison with version 4" })).toEqual(
      [],
    );
  });

  it("goes back to version 4 on Discard, and drops the alert", async () => {
    await withThree();
    await save();
    await act(async () => button("Discard")!.props.onClick());
    expect(renderer!.root.findAllByProps({ role: "alert" })).toEqual([]);
    expect(select("Owner of Menu").props.value).toBe(BOB);
    expect(footer()).toContain("No changes from version 4");
  });

  it("says another save came first again if the map changed once more", async () => {
    await withThree();
    await save();
    mocks.command.mockResolvedValueOnce(conflict({ ...V4, version: 5, updatedBy: CYRIL }));
    await save();
    const alert = words(renderer!.root.findByProps({ role: "alert" }));
    expect(alert).toContain("Cyril saved version 5 while you were editing");
    expect(select("Owner of Menu").props.value).toBe(CYRIL);
  });
});

describe("what the Hub refuses", () => {
  it("says why and keeps the draft, so the lead can fix it and save again", async () => {
    mocks.command.mockResolvedValueOnce(
      refused("areas.Menu: dan@acme.test is not on this project"),
    );
    await show(EVA);
    await pick("Owner of Menu", CYRIL);
    await save();
    expect(words(renderer!.root.findByProps({ role: "alert" }))).toBe(
      "areas.Menu: dan@acme.test is not on this project",
    );
    expect(select("Owner of Menu").props.value).toBe(CYRIL);
    expect(button("Save owner map")?.props.disabled).toBe(false);
    mocks.command.mockResolvedValueOnce(ok({ ...V3, version: 4 }));
    await save();
    expect(footer()).toContain("Saved as version 4.");
  });

  it("says a lead may no longer edit it, when the Hub refuses", async () => {
    mocks.command.mockResolvedValueOnce(
      refused("only a lead of the project or an admin edits its owner map", "ownership_forbidden"),
    );
    await show(EVA);
    await pick("Owner of Menu", CYRIL);
    await save();
    expect(words(renderer!.root.findByProps({ role: "alert" }))).toBe(
      "only a lead of the project or an admin edits its owner map",
    );
  });

  it("sends one save at a time", async () => {
    let settle: (value: unknown) => void = () => undefined;
    mocks.command.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    await show(EVA);
    await pick("Owner of Menu", CYRIL);
    await act(async () => {
      button("Save owner map")!.props.onClick();
      button("Save owner map")?.props.onClick();
    });
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(button("Saving…")?.props.disabled).toBe(true);
    await act(async () => settle(ok({ ...V3, version: 4 })));
    expect(footer()).toContain("Saved as version 4.");
  });
});

describe("while the Hub's map changes under the page", () => {
  it("follows it while the lead has made no edit", async () => {
    await show(EVA);
    const next = ownershipOf(EVA, {
      ownership: { map: { ...V3, version: 4, areas: { ...V3.areas, Menu: CYRIL } } },
    });
    await act(async () => renderer!.update(element(next)));
    expect(select("Owner of Menu").props.value).toBe(CYRIL);
    expect(footer()).toContain("No changes from version 4");
  });

  it("leaves the lead's draft alone, which a save finds out", async () => {
    await show(EVA);
    await pick("Owner of Menu", CYRIL);
    const next = ownershipOf(EVA, {
      ownership: { map: { ...V3, version: 4, areas: { ...V3.areas, Menu: BOB } } },
    });
    await act(async () => renderer!.update(element(next)));
    expect(select("Owner of Menu").props.value).toBe(CYRIL);
    expect(footer()).toContain("1 change from version 3");
  });
});
