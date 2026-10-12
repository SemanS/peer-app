import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  getProviderSummary,
  getProviderVersionAdvisoryPresentation,
  providerConnection,
  providerReadiness,
} from "./providerStatus";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated", label: "ChatGPT" },
  checkedAt: "2026-08-23T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

describe("getProviderSummary", () => {
  it("reports ready providers with unknown authentication as available", () => {
    expect(getProviderSummary({ ...provider, auth: { status: "unknown" } })).toEqual({
      headline: "Available",
      detail: null,
    });
  });

  it("does not hide a provider error behind a previous authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        message: "The provider process failed to start.",
      }),
    ).toEqual({
      headline: "Unavailable",
      detail: "The provider process failed to start.",
    });
  });

  it("does not hide a provider warning behind an authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "warning",
        message: "The provider version is unsupported.",
      }),
    ).toEqual({
      headline: "Needs attention",
      detail: "The provider version is unsupported.",
    });
  });

  it("keeps authentication failures actionable when their provider status is error", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Run codex login.",
      }),
    ).toEqual({
      headline: "Not authenticated",
      detail: "Run codex login.",
    });
  });

  it("treats a disabled provider status as disabled even before its enabled flag updates", () => {
    expect(getProviderSummary({ ...provider, status: "disabled" }).headline).toBe("Disabled");
  });
});

it("does not suggest copying a command that installs an incompatible latest version", () => {
  const advisory = {
    status: "behind_latest" as const,
    currentVersion: "1.0.0",
    latestVersion: "2.0.0",
    updateCommand: "npm install -g fixture@latest",
    canUpdate: true,
    checkedAt: provider.checkedAt,
    message: null,
  };
  const compatibility = {
    status: "supported" as const,
    latestVersionStatus: "broken" as const,
    message: null,
    recommendedRange: null,
    recommendedVersion: null,
  };
  expect(getProviderVersionAdvisoryPresentation(advisory, compatibility)).toBeNull();
  expect(
    getProviderVersionAdvisoryPresentation(advisory, { ...compatibility, status: "broken" }, false),
  ).toBeNull();
  expect(
    getProviderVersionAdvisoryPresentation(advisory, {
      ...compatibility,
      latestVersionStatus: "supported",
    }),
  ).not.toBeNull();
});

it("shows compatibility in the version popover even when the installed version is current", () => {
  const advisory = {
    status: "current" as const,
    currentVersion: "2.0.0",
    latestVersion: "2.0.0",
    updateCommand: "npm install -g fixture@latest",
    canUpdate: true,
    checkedAt: provider.checkedAt,
    message: null,
  };
  const compatibility = {
    status: "broken" as const,
    latestVersionStatus: "broken" as const,
    message: "This version drops turns. Use 1.9.0.",
    recommendedRange: null,
    recommendedVersion: "1.9.0",
  };
  expect(getProviderVersionAdvisoryPresentation(advisory, compatibility)).toEqual({
    title: "Known broken version",
    detail: compatibility.message,
    updateCommand: null,
    emphasis: "strong",
    targetVersion: "1.9.0",
  });
  expect(
    getProviderVersionAdvisoryPresentation(undefined, {
      ...compatibility,
      status: "graceful",
      recommendedVersion: null,
      recommendedRange: ">=2.1.0",
      message: null,
    }),
  ).toEqual({
    title: "Limited support",
    detail: "Use >=2.1.0 for full support.",
    updateCommand: null,
    emphasis: "normal",
    targetVersion: null,
  });
});

describe("provider status copy", () => {
  it("surfaces an ACP-advertised authentication method", () => {
    const provider = {
      enabled: true,
      installed: true,
      status: "error",
      auth: { status: "unauthenticated", type: "agent", label: "Company login" },
      message: "Complete this authentication method on the server.",
    } as ServerProvider;

    expect(getProviderSummary(provider)).toEqual({
      headline: "Not authenticated · Company login",
      detail: "Complete this authentication method on the server.",
    });
  });
});

describe("providerConnection", () => {
  it("says a signed-in provider that passes its checks is connected, with its plan", () => {
    expect(
      providerConnection(
        { ...provider, auth: { status: "authenticated", label: "ChatGPT Pro 20x Subscription" } },
        true,
      ),
    ).toEqual({ state: "connected", detail: "ChatGPT Pro 20x Subscription" });
    expect(
      providerConnection({ ...provider, version: null, auth: { status: "unknown" } }, true),
    ).toEqual({ state: "connected" });
  });

  it("names the first thing a provider is missing as a setup step", () => {
    expect(providerConnection({ ...provider, installed: false, version: null }, true)).toEqual({
      state: "setup",
      step: { n: 1, of: 2, title: "install it" },
    });
    expect(
      providerConnection(
        { ...provider, auth: { status: "unauthenticated" }, message: "Run codex login." },
        true,
      ),
    ).toEqual({
      state: "setup",
      step: { n: 2, of: 2, title: "sign in" },
      detail: "Run codex login.",
    });
  });

  it("asks for sign-in before it reports the failed checks that follow from it", () => {
    expect(
      providerConnection(
        {
          ...provider,
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Run codex login.",
        },
        true,
      ).state,
    ).toBe("setup");
  });

  it("reports a failed or doubtful check as a problem, in the server's words", () => {
    expect(
      providerConnection(
        { ...provider, status: "error", message: "The process failed to start." },
        true,
      ),
    ).toEqual({ state: "problem", detail: "The process failed to start." });
    expect(providerConnection({ ...provider, status: "warning" }, true)).toEqual({
      state: "problem",
      label: "Needs attention",
      detail: "The provider is installed, but the server could not fully verify it.",
    });
  });

  it("says off for a provider turned off, whatever its last status was", () => {
    expect(providerConnection(provider, false).state).toBe("off");
    expect(providerConnection({ ...provider, enabled: false }, true).state).toBe("off");
    expect(providerConnection({ ...provider, status: "disabled" }, true).state).toBe("off");
  });

  it("says not available for a provider this build does not have, and checking before any status", () => {
    expect(
      providerConnection(
        { ...provider, availability: "unavailable", unavailableReason: "Driver missing." },
        true,
      ),
    ).toEqual({ state: "unavailable", detail: "Driver missing." });
    expect(providerConnection(undefined, true)).toMatchObject({
      state: "unavailable",
      label: "Checking\u2026",
    });
  });
});

describe("providerReadiness", () => {
  const marks = (checks: ReturnType<typeof providerReadiness>) =>
    checks.map((check) => `${check.id}:${check.mark}`);

  it("is all yes for an installed, signed-in provider whose last check passed", () => {
    const checks = providerReadiness(
      { ...provider, auth: { status: "authenticated", label: "ChatGPT Pro 20x Subscription" } },
      true,
    );
    expect(marks(checks)).toEqual(["installed:yes", "signed-in:yes", "runs:yes"]);
    expect(checks[0]?.detail).toBe("Version 1.0.0, found on this computer.");
    expect(checks[1]?.detail).toBe("ChatGPT Pro 20x Subscription, as the provider reports it.");
  });

  it("says why a provider is not installed or not signed in, without checking what follows", () => {
    const notInstalled = providerReadiness(
      { ...provider, installed: false, version: null, message: "CLI not detected on PATH." },
      true,
    );
    expect(marks(notInstalled)).toEqual(["installed:no", "signed-in:yes", "runs:unknown"]);
    expect(notInstalled[0]?.detail).toBe("CLI not detected on PATH.");
    const signedOut = providerReadiness(
      { ...provider, auth: { status: "unauthenticated" }, message: "Run codex login." },
      true,
    );
    expect(marks(signedOut)).toEqual(["installed:yes", "signed-in:no", "runs:unknown"]);
    expect(signedOut[1]?.detail).toBe("Run codex login.");
  });

  it("does not claim a sign-in the provider does not report", () => {
    const checks = providerReadiness({ ...provider, auth: { status: "unknown" } }, true);
    expect(marks(checks)).toEqual(["installed:yes", "signed-in:unknown", "runs:yes"]);
  });

  it("fails the last check with the server's message", () => {
    const checks = providerReadiness(
      { ...provider, status: "error", message: "The process failed to start." },
      true,
    );
    expect(checks[2]).toMatchObject({ mark: "no", detail: "The process failed to start." });
  });

  it("leaves the last check open for a provider turned off or not yet reported", () => {
    expect(providerReadiness(provider, false)[2]).toMatchObject({
      mark: "unknown",
      detail: "Turned off for new chats.",
    });
    expect(marks(providerReadiness(undefined, true))).toEqual([
      "installed:unknown",
      "signed-in:unknown",
      "runs:unknown",
    ]);
  });
});
