import { describe, expect, it, vi } from "vite-plus/test";
vi.mock("@t3tools/contracts", async (original) => ({
  ...(await original<typeof import("@t3tools/contracts")>()),
  PEER_MEMORY_AVAILABLE: true,
}));
import { memoryEnvironmentState, hasActiveMemory } from "./memory.logic";

const state = (active: boolean) => ({
  plugins: [
    {
      id: "memory",
      title: "Memory",
      enabled: active,
      active,
      ...(active ? {} : { reason: "off" }),
    },
  ],
});
describe("Memory on connected environments", () => {
  it("distinguishes active, inactive and mixed environments", () => {
    expect(memoryEnvironmentState(state(true))).toBe("active");
    expect(memoryEnvironmentState(state(false))).toBe("off");
    expect(hasActiveMemory([state(false), state(true)])).toBe(true);
    expect(hasActiveMemory([state(false)])).toBe(false);
    expect(memoryEnvironmentState(null)).toBe("loading");
  });
});
