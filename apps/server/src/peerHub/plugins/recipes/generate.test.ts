import { expect, it } from "@effect/vitest";
import { generate, parseRecipe } from "./generate.ts";
const source = (meta = "title: A recipe\naccess: read", body = "Input: {{input}}") =>
  `---\n${meta}\n---\n${body}`;
it("refuses every malformed source before a table can be shipped", () => {
  for (const [name, text] of [
    ["Bad", source()],
    ["a".repeat(41), source()],
    ["good", source("title: A\naccess: other")],
    ["good", source("access: read")],
    ["good", source("title: A\naccess: read\nextra: true")],
    ["good", source("title: A\naccess: read\nrequires: [nonsense]")],
    ["good", source("title: " + "x".repeat(61) + "\naccess: read")],
    ["good", source(undefined, "x".repeat(2401) + "{{input}}")],
    ["good", source(undefined, "none")],
    ["good", source(undefined, "{{input}} {{input}}")],
  ] as const)
    expect(() => parseRecipe(name, text)).toThrow(name);
  expect(parseRecipe("good", source().replaceAll("\n", "\r\n")).body).toBe("Input: {{input}}");
  expect(() =>
    generate([
      { name: "good", text: source() },
      { name: "good", text: source() },
    ]),
  ).toThrow("duplicate");
});
