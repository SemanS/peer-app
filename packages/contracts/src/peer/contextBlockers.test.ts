import { describe, expect, it } from "vite-plus/test";
import { contextBlockerText } from "./contextBlockers.ts";

describe("reported blockers", () => {
  it.each([
    "",
    "- ",
    "None.",
    "- **None**.",
    "No blockers.",
    "No known blockers.",
    "No blockers reported.",
    "Not blocked.",
    "N/A",
    "None for this task.",
    "None for the import. Feature tasks intentionally remain open.",
  ])("does not turn an explicit no-blocker report into attention: %s", (text) => {
    expect(contextBlockerText(text)).toBeUndefined();
  });

  it.each([
    "Waiting for production credentials.",
    "None of the required permissions are granted.",
    "No blockers have been resolved.",
    "No blockers except missing approval.",
    "None for the import, but deployment needs a key.",
    "None for the import; deployment is blocked.",
    "No blockers? Waiting for confirmation.",
  ])("preserves concrete or ambiguous reports: %s", (text) => {
    expect(contextBlockerText(text)).toBe(text);
  });

  it("keeps a blocker after a no-blocker sentence in the same line", () => {
    expect(
      contextBlockerText(
        "None for the import. Feature tasks intentionally remain open. Deployment needs a key.",
      ),
    ).toBe("Deployment needs a key.");
  });
});
