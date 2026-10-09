import { describe, expect, it } from "vite-plus/test";
import { startInput } from "./StartTaskAgent.logic";
describe("task launch input", () => {
  it("keeps sender data out of request instructions without changing normal prompts", () => {
    const request = { id: "one" } as Parameters<typeof startInput>[0];
    expect(startInput(request, "  My own instruction  ")).toEqual({
      requestId: "one",
      instruction: "My own instruction",
    });
    expect(startInput(undefined, "  Ordinary prompt  ")).toEqual({ prompt: "Ordinary prompt" });
  });
});
