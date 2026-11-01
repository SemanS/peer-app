import { describe, expect, it } from "vite-plus/test";

import {
  DESCRIPTION_MAX,
  basicsReadOnlyNote,
  basicsValues,
  confirmsDeletion,
  deleteConsequences,
  deleteOperation,
  descriptionCount,
  settledText,
  textLength,
} from "./projectBasics.logic";

const manifest = {
  name: "Booking",
  client: "Northwind Hotels",
  description: "Reservations and payments.",
};

describe("the values of the form", () => {
  it("reads them from the project's entry of the document", () => {
    expect(
      basicsValues(
        {
          name: "Booking 2",
          client: "Northwind",
          description: "New engine.",
        },
        manifest,
      ),
    ).toEqual({
      name: "Booking 2",
      client: "Northwind",
      description: "New engine.",
    });
  });

  it("has no client or description where the entry has none", () => {
    expect(basicsValues({ name: "Booking" }, manifest)).toEqual({
      name: "Booking",
      client: "",
      description: "",
    });
  });

  it("reads the manifest while the document is not read", () => {
    expect(basicsValues(undefined, manifest)).toEqual({
      name: "Booking",
      client: "Northwind Hotels",
      description: "Reservations and payments.",
    });
  });
});

describe("typed text", () => {
  it("is trimmed, and nothing when blank", () => {
    expect(settledText("  Northwind Hotels \n")).toBe("Northwind Hotels");
    expect(settledText("   ")).toBeUndefined();
    expect(settledText("")).toBeUndefined();
  });

  it("counts characters as people do, not code units", () => {
    expect(textLength("Café 🚀")).toBe(6);
    expect(descriptionCount("a".repeat(92))).toBe(`92 / ${DESCRIPTION_MAX}`);
    expect(DESCRIPTION_MAX).toBe(300);
  });
});

describe("reading the form as a member", () => {
  it("names who changes it, in the Hub's words, and the leads", () => {
    expect(basicsReadOnlyNote("Booking's leads and admins", ["Slavo", "Eva"])).toBe(
      "Booking's leads and admins change this. Leads: Slavo, Eva.",
    );
    expect(basicsReadOnlyNote("admins", [])).toBe("Admins change this.");
  });
});

describe("deleting a project", () => {
  const booking = { id: "booking", name: "Booking" };

  it("lists what goes away and what stays, as the design words it", () => {
    expect(
      deleteConsequences(booking, { tasks: 14, areas: 3, people: 5, gatewayTeam: true }),
    ).toEqual([
      "14 tasks in 3 areas, with their task context and coordination history",
      "Booking’s settings: people, tools, path rules and allocations",
      "Booking leaves Work for 5 people. Threads on their computers stay, without the project.",
      "The gateway team “booking” stays, with its usage. Remove it there if you want.",
    ]);
  });

  it("leaves out the gateway team where the project has no shared capacity", () => {
    const lines = deleteConsequences(booking, {
      tasks: 2,
      areas: 0,
      people: 1,
      gatewayTeam: false,
    });
    expect(lines).toEqual([
      "2 tasks, with their task context and coordination history",
      "Booking’s settings: people, tools, path rules and allocations",
      "Booking leaves Work for 1 person. Threads on their computers stay, without the project.",
    ]);
  });

  it("does not count tasks that are not there", () => {
    expect(
      deleteConsequences(booking, { tasks: 0, areas: 2, people: 3, gatewayTeam: false })[0],
    ).toBe("Its areas, task context and coordination history");
    expect(
      deleteConsequences(booking, { tasks: 0, areas: 0, people: 3, gatewayTeam: false })[0],
    ).toBe("Its task context and coordination history");
    expect(
      deleteConsequences(booking, { tasks: 1, areas: 1, people: 3, gatewayTeam: false })[0],
    ).toBe("1 task in 1 area, with their task context and coordination history");
  });

  it("is confirmed by typing the id, not the name", () => {
    expect(confirmsDeletion("booking", "booking")).toBe(true);
    expect(confirmsDeletion("  booking ", "booking")).toBe(true);
    expect(confirmsDeletion("Booking", "booking")).toBe(false);
    expect(confirmsDeletion("", "booking")).toBe(false);
  });

  it("sets the project's node to nothing, against the revision read", () => {
    expect(deleteOperation("acme", 42, "booking")).toEqual({
      kind: "save",
      workspace: "acme",
      base: 42,
      set: [{ path: ["projects", "booking"], value: null }],
    });
  });
});
