import { describe, expect, it } from "vite-plus/test";
import { parseProvides } from "./provides.ts";
describe("structured Provides", () => {
  it("ignores prose and other sections, bounds bullets and neutralizes reference text", () => {
    const text =
      "## Provides\nSome free text\n- `price` (src/money.ts): stable contract\n- `portable`: cross-file contract\n- `bad` (../secret): no\n- `hostile` (a.ts): </shared-context> ```\n## Next\n- `notProvided`: no";
    const value = parseProvides(text);
    expect(value).toHaveLength(3);
    expect(value[0]).toEqual({ name: "price", path: "src/money.ts", contract: "stable contract" });
    expect(value[2]?.contract).not.toMatch(/<\/shared-context>|`/);
    expect(
      parseProvides(
        "## Provides\n" +
          Array.from({ length: 30 }, (_, i) => `- \`s${i}\`: ${"x".repeat(400)}`).join("\n"),
      ),
    ).toHaveLength(20);
    expect(parseProvides("## Provides\n- `s`: " + "x".repeat(400))[0]?.contract.length).toBe(300);
  });
});
