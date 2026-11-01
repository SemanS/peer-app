import { describe, expect, it } from "vite-plus/test";
import { toggleInput } from "./dependencies.logic";
describe("dependency menu choices", () => {
  it("reverses an existing edge without optimistic edits", () => {
    expect(toggleInput("a", true)).toEqual({ remove: ["a"] });
    expect(toggleInput("a", false)).toEqual({ add: ["a"] });
  });
});
