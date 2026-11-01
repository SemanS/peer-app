import { describe, expect, it } from "vite-plus/test";

import {
  nativeCliLoanDescription,
  nativeCliProgressDescription,
  releaseUnusedLoan,
  resolveNativeCliAgent,
} from "./nativeCli.logic";

describe("resolveNativeCliAgent", () => {
  const claude = { driver: "claudeAgent", nativeId: "6c23bd41" };
  const codex = { driver: "codex", nativeId: "019a" };

  it("names the CLI of the two agents that have one", () => {
    expect(resolveNativeCliAgent({ nativeThreadRef: claude, instanceConfig: {} })).toBe(
      "Claude Code",
    );
    expect(resolveNativeCliAgent({ nativeThreadRef: codex, instanceConfig: {} })).toBe("Codex");
  });

  it("offers nothing for another provider or a thread with no real session", () => {
    for (const nativeThreadRef of [
      null,
      { driver: "cursor", nativeId: "abc" },
      { driver: "claudeAgent", nativeId: null },
      { driver: "claudeAgent", nativeId: "pending:run-1" },
    ]) {
      expect(resolveNativeCliAgent({ nativeThreadRef, instanceConfig: {} })).toBeNull();
    }
  });

  it("hides managed Codex, whose login cannot leave Peer", () => {
    expect(
      resolveNativeCliAgent({ nativeThreadRef: codex, instanceConfig: { setupMode: "managed" } }),
    ).toBeNull();
    expect(
      resolveNativeCliAgent({ nativeThreadRef: codex, instanceConfig: { setupMode: "existing" } }),
    ).toBe("Codex");
  });
});

describe("the wait Codex imposes", () => {
  it("is named wherever a Codex session is lent or read back", () => {
    for (const operation of ["continue", "return"] as const) {
      expect(nativeCliProgressDescription(operation, "Codex")).toContain("about a minute");
      expect(nativeCliProgressDescription(operation, "Claude Code")).not.toContain("minute after");
    }
    expect(nativeCliProgressDescription("fork", "Codex")).not.toContain("about a minute");
    expect(nativeCliLoanDescription("Codex")).toContain("about a minute later");
    expect(nativeCliLoanDescription("Claude Code")).not.toContain("minute");
  });
});

describe("releaseUnusedLoan", () => {
  it("closes the terminal first, since a live shell would refuse the return", async () => {
    const order: Array<string> = [];
    const result = await releaseUnusedLoan({
      closeTerminal: async () => order.push("close"),
      returnFromCli: async () => {
        order.push("return");
        return "returned";
      },
    });
    expect(order).toEqual(["close", "return"]);
    expect(result).toBe("returned");
  });

  it("still returns when the close fails", async () => {
    const result = await releaseUnusedLoan({
      closeTerminal: () => Promise.reject(new Error("gone")),
      returnFromCli: async () => "returned",
    });
    expect(result).toBe("returned");
  });
});
