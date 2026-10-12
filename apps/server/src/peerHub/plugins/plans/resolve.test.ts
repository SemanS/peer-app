import { describe, expect, it } from "vite-plus/test";
import type { CodeGraph } from "./client/codegraph.ts";
import type { Items } from "./client/hub.ts";
import { resolveItems, resolveName } from "./client/resolve.ts";

const items = (over: Partial<Items> = {}): Items => ({
  changes: [],
  maybes: [],
  uses: [],
  provides: [],
  ...over,
});

describe("what the symbols of a file say of a name", () => {
  const listed = ["Invoice", "Invoice.amount", "Invoice.amountCents", "Totals::sum", "Order#total"];

  it("keeps a name the index lists", () => {
    expect(resolveName("Invoice.amount", listed)).toEqual({
      name: "Invoice.amount",
      known: true,
      candidates: [],
    });
    expect(resolveName("Invoice", listed).known).toBe(true);
  });

  it("makes a short name the one symbol that ends with it, at an identifier boundary", () => {
    expect(resolveName("amountCents", listed)).toEqual({
      name: "Invoice.amountCents",
      known: true,
      candidates: [],
    });
    expect(resolveName("sum", listed).name).toBe("Totals::sum");
    expect(resolveName("total", listed).name).toBe("Order#total");
  });

  it("does not take a name for a longer one that merely ends in the same letters", () => {
    const found = resolveName("mount", ["Invoice.amount"]);
    expect(found).toEqual({ name: "mount", known: false, candidates: [] });
    expect(resolveName("Cents", ["Invoice.amountCents"]).known).toBe(false);
  });

  it("keeps an ambiguous name as written and names the symbols that end with it", () => {
    expect(
      resolveName("amount", ["Invoice.amount", "Line::amount", "Total#amount", "amounts"]),
    ).toEqual({
      name: "amount",
      known: false,
      candidates: ["Invoice.amount", "Line::amount", "Total#amount"],
    });
  });

  it("knows a qualified name by its last part, which an index that lists names flat has", () => {
    expect(resolveName("Invoice.amount", ["Invoice", "amount"])).toEqual({
      name: "Invoice.amount",
      known: true,
      candidates: [],
    });
    expect(resolveName("Invoice.balance", ["Invoice", "amount"]).known).toBe(false);
    expect(resolveName("Ns::run", ["run"]).known).toBe(true);
  });

  it("keeps a name nothing in the file resembles, with no candidates", () => {
    expect(resolveName("brandNew", listed)).toEqual({
      name: "brandNew",
      known: false,
      candidates: [],
    });
    expect(resolveName("anything", [])).toEqual({ name: "anything", known: false, candidates: [] });
  });
});

/** An index with these files, counting what it was asked. */
const graph = (
  files: Readonly<Record<string, ReadonlyArray<string>>>,
  options: { ready?: boolean | "throws"; failing?: ReadonlyArray<string> } = {},
) => {
  const asked: string[] = [];
  const reader: CodeGraph = {
    ready: async () => {
      asked.push("ready");
      if (options.ready === "throws") throw new Error("codegraph is not installed");
      return options.ready ?? true;
    },
    symbols: async (_root, path) => {
      asked.push(path);
      if (options.failing?.includes(path)) throw new Error("process deadline");
      return files[path] ?? [];
    },
  };
  return { reader, asked };
};

describe("a declaration's names checked against the index", () => {
  it("needs no index for items that name no symbol", async () => {
    const { reader, asked } = graph({});
    const out = await resolveItems(
      reader,
      "/work",
      items({ changes: [{ path: "src/a.ts" }], maybes: [{ path: "src/dir/" }] }),
      () => 0,
    );
    expect(asked).toEqual([]);
    expect(out.notes).toEqual({ index: "unneeded", unresolved: [] });
  });

  it("makes a short name the symbol it ends and lists the names it does not know", async () => {
    const { reader } = graph({
      "src/invoice.ts": [
        "Invoice",
        "Invoice.amount",
        "refundCents",
        "Fee.refund",
        "Invoice.refund",
      ],
    });
    const out = await resolveItems(
      reader,
      "/work",
      items({
        changes: [
          { path: "src/invoice.ts", name: "amount" },
          { path: "src/invoice.ts", name: "refundCents" },
          { path: "src/invoice.ts" },
        ],
        uses: [
          { path: "src/invoice.ts", name: "refund" },
          { path: "src/invoice.ts", name: "brandNew" },
        ],
      }),
      () => 0,
    );
    expect(out.items.changes).toEqual([
      { path: "src/invoice.ts", name: "Invoice.amount" },
      { path: "src/invoice.ts", name: "refundCents" },
      { path: "src/invoice.ts" },
    ]);
    expect(out.items.uses).toEqual([
      { path: "src/invoice.ts", name: "refund" },
      { path: "src/invoice.ts", name: "brandNew" },
    ]);
    expect(out.notes).toEqual({
      index: "ready",
      unresolved: [
        { path: "src/invoice.ts", name: "refund", candidates: ["Fee.refund", "Invoice.refund"] },
        { path: "src/invoice.ts", name: "brandNew", candidates: [] },
      ],
    });
  });

  it("collapses two names that become one symbol", async () => {
    const { reader } = graph({ "src/a.ts": ["Order.total"] });
    const out = await resolveItems(
      reader,
      "/work",
      items({
        uses: [
          { path: "src/a.ts", name: "total" },
          { path: "src/a.ts", name: "Order.total" },
        ],
      }),
      () => 0,
    );
    expect(out.items.uses).toEqual([{ path: "src/a.ts", name: "Order.total" }]);
  });

  it("keeps every name as written, and says so, when the index is not ready or cannot be run", async () => {
    const given = items({ changes: [{ path: "src/a.ts", name: "total" }] });
    for (const ready of [false, "throws"] as const) {
      const { reader, asked } = graph({ "src/a.ts": ["Order.total"] }, { ready });
      const out = await resolveItems(reader, "/work", given, () => 0);
      expect(out.items).toBe(given);
      expect(out.notes).toEqual({ index: "unusable", unresolved: [] });
      expect(asked).toEqual(["ready"]);
    }
  });

  it("leaves a file it cannot read as written, without calling its names unknown", async () => {
    const { reader } = graph({ "src/b.ts": ["Order.total"] }, { failing: ["src/a.ts"] });
    const out = await resolveItems(
      reader,
      "/work",
      items({
        changes: [
          { path: "src/a.ts", name: "total" },
          { path: "src/b.ts", name: "total" },
        ],
      }),
      () => 0,
    );
    expect(out.items.changes).toEqual([
      { path: "src/a.ts", name: "total" },
      { path: "src/b.ts", name: "Order.total" },
    ]);
    expect(out.notes.unresolved).toEqual([]);
  });

  it("reads the symbols of at most ten files, each once", async () => {
    const paths = Array.from({ length: 14 }, (_, at) => `src/f${at}.ts`);
    const { reader, asked } = graph({});
    await resolveItems(
      reader,
      "/work",
      items({
        changes: paths.map((path) => ({ path, name: "x" })),
        uses: [{ path: "src/f0.ts", name: "y" }],
      }),
      () => 0,
    );
    expect(asked).toEqual(["ready", ...paths.slice(0, 10)]);
  });

  it("stops beginning files once its three seconds are spent", async () => {
    let time = 0;
    const { reader, asked } = graph({});
    const slow: CodeGraph = {
      ready: reader.ready,
      symbols: async (root, path, now) => {
        time += 2_000;
        return reader.symbols(root, path, now);
      },
    };
    await resolveItems(
      slow,
      "/work",
      items({
        changes: ["a", "b", "c", "d"].map((name) => ({ path: `src/${name}.ts`, name: "x" })),
      }),
      () => time,
    );
    expect(asked).toEqual(["ready", "src/a.ts", "src/b.ts"]);
  });
});
