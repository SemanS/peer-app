import { describe, expect, it } from "vite-plus/test";

import { draftSets, edit, type DraftState } from "./settingsDraft.logic";

import {
  POLICY_CHOICES,
  choiceEdit,
  choiceOf,
  readCoordination,
  type Edit,
} from "./projectCoordination.logic";

describe("the policy", () => {
  it("lists each person decides first, then the four policies, with the design's words", () => {
    expect(POLICY_CHOICES.map((choice) => [choice.value, choice.title])).toEqual([
      ["computer", "Each person decides"],
      ["notify", "notify"],
      ["coordinate", "coordinate"],
      ["ask", "ask"],
      ["exclusive", "exclusive"],
    ]);
    expect(POLICY_CHOICES[0]?.description).toBe(
      "Every computer’s own default applies (Settings › This computer).",
    );
  });

  it("reads a project's coordination: its policy", () => {
    expect(readCoordination({ policy: "coordinate" })).toEqual({ policy: "coordinate" });
  });

  it("reads no coordination as each person deciding", () => {
    expect(readCoordination(undefined)).toEqual({ policy: undefined });
    expect(readCoordination({})).toEqual({ policy: undefined });
  });

  it.each<[string | undefined, string | null]>([
    [undefined, "computer"],
    ["notify", "notify"],
    ["exclusive", "exclusive"],
    ["whenever", null],
  ])("shows a project policy of %j as the choice %j", (policy, choice) => {
    expect(choiceOf(policy)).toBe(choice);
  });

  it("sets a policy, and for each person decides takes the whole coordination away", () => {
    expect(choiceEdit("ask")).toEqual({ path: ["policy"], value: "ask" });
    expect(choiceEdit("computer")).toEqual({ path: [], value: undefined });
  });
});

describe("what a draft saves, for the edits the page makes", () => {
  const slice = ["projects", "booking", "coordination"];
  const at = (...below: string[]) => [...slice, ...below];
  const coordination = { policy: "coordinate" };

  /** Applies the edits to a draft of the document, as the page does one after the other. */
  const saves = (
    edits: ReadonlyArray<Edit>,
    project: unknown = { name: "Booking", coordination },
  ) => {
    const document = { projects: { booking: project } };
    const state = edits.reduce<DraftState | null>(
      (draft, change) =>
        edit(draft, "booking", { revision: 7, document }, slice, change.path, change.value),
      null,
    );
    return state === null
      ? []
      : draftSets(state.base, state.document, slice).sort((a, b) =>
          a.path.join("/").localeCompare(b.path.join("/")),
        );
  };

  it("sends a new policy as the policy", () => {
    expect(saves([choiceEdit("ask")])).toEqual([{ path: at("policy"), value: "ask" }]);
    expect(saves([choiceEdit("ask"), choiceEdit("coordinate")])).toEqual([]);
  });

  it("sends a policy for a project that had none as its whole coordination", () => {
    expect(saves([choiceEdit("notify")], { name: "Booking" })).toEqual([
      { path: slice, value: { policy: "notify" } },
    ]);
  });

  it("takes the coordination away for each person decides, which a project without any already is", () => {
    expect(
      saves([choiceEdit("computer")], { name: "Booking", coordination: { policy: "ask" } }),
    ).toEqual([{ path: slice, value: null }]);
    expect(saves([choiceEdit("computer")], { name: "Booking" })).toEqual([]);
  });
});
