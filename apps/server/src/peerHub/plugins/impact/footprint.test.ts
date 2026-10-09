import { describe, expect, it } from "vite-plus/test";
import { computeFootprint, newFootprintState } from "./footprint.ts";
const symbols = [
  { name: "Container", path: "a.ts", start: 1, end: 7, signature: "" },
  { name: "price", path: "a.ts", start: 2, end: 5, signature: "(\nvalue: number\n): number" },
];
const files = new Map([
  [
    "a.ts",
    {
      text: "class Container {\n price(\n value: number\n ): number {\n return value;\n }\n}\n",
      hunks: [{ start: 3, end: 3 }],
      newFile: false,
    },
  ],
]);
describe("private footprint projection", () => {
  it("assigns innermost declaration/body lines, hashes locally, and caches repository-only uses", async () => {
    const state = newFootprintState(),
      calls: string[] = [],
      read = async () => symbols,
      callees = async () => {
        calls.push("callees");
        return [
          { name: "dep", path: "dep.ts" },
          { name: "outside", path: "../secret" },
        ];
      };
    const one = await computeFootprint({
      session: "a",
      project: "p",
      files,
      state,
      symbols: read,
      callees,
      provided: [],
    });
    expect(one.changed.map((v) => [v.name, v.change, v.rev])).toEqual([["price", "signature", 1]]);
    expect(one.uses).toEqual([{ name: "dep", path: "dep.ts", from: "price", fromPath: "a.ts" }]);
    const two = await computeFootprint({
      session: "a",
      project: "p",
      files,
      state,
      symbols: read,
      callees,
      provided: [],
    });
    expect(two.changed[0]?.rev).toBe(1);
    expect(calls).toHaveLength(1);
    const modified = new Map([
      [
        "a.ts",
        {
          ...files.get("a.ts")!,
          text: files.get("a.ts")!.text.replace("return value", "return 2"),
          hunks: [{ start: 5, end: 5 }],
        },
      ],
    ]);
    const three = await computeFootprint({
      session: "a",
      project: "p",
      files: modified,
      state,
      symbols: read,
      callees,
      provided: [],
    });
    expect(three.changed[0]).toMatchObject({ change: "body", rev: 2 });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(three)).not.toMatch(
      /class Container|startLine|endLine|hash|return value/,
    );
  });
  it("only recognizes removed symbols from a previous map of a nonempty file and marks new symbols signature", async () => {
    const state = newFootprintState(),
      input = {
        session: "a",
        project: "p",
        files,
        state,
        symbols: async () => symbols,
        callees: async () => [],
        provided: [],
      };
    await computeFootprint(input);
    const gone = await computeFootprint({ ...input, symbols: async () => [symbols[0]!] });
    expect(gone.changed.some((v) => v.name === "price" && v.change === "removed")).toBe(true);
    const repeat = await computeFootprint({ ...input, symbols: async () => [symbols[0]!] });
    expect(repeat.changed.find((v) => v.name === "price")).toEqual(
      gone.changed.find((v) => v.name === "price"),
    );
    const restored = await computeFootprint(input);
    expect(restored.changed.find((v) => v.name === "price")).toMatchObject({
      change: "signature",
      rev: 3,
    });
    const empty = await computeFootprint({
      ...input,
      symbols: async () => [],
      files: new Map([["a.ts", { text: "", hunks: [], newFile: false }]]),
    });
    expect(empty.changed).toEqual([]);
    const fresh = await computeFootprint({
      ...input,
      state: newFootprintState(),
      files: new Map([["a.ts", { ...files.get("a.ts")!, newFile: true }]]),
    });
    expect(fresh.changed.every((v) => v.change === "signature")).toBe(true);
  });
});
