import { describe, expect, it } from "vite-plus/test";

import { resumeEnabled } from "./settle.logic";

describe("the resume switch", () => {
  it("is on until the plugin reports it off", () => {
    expect(resumeEnabled({})).toBe(true);
    expect(resumeEnabled({ settle: { resume: false, attempts: [] } })).toBe(false);
  });
});
