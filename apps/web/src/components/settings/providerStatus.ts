import {
  isProviderAvailable,
  type ServerProvider,
  type ServerProviderVersionAdvisory,
  type ServerProviderCompatibilityAdvisory,
} from "@t3tools/contracts";

import type { ConnectionState, ConnectionStep } from "./connectionStatus.logic";

/**
 * Visual treatment for each server-reported provider status. Centralized so
 * the default-driver card and per-instance cards share the same language.
 */
export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-muted-foreground/50",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

/**
 * Derive the headline + detail copy shown under a provider's name in the
 * settings page. Prefers `provider.message` for server-supplied detail and
 * falls back to generic phrasing when the server has not yet reported any
 * state — which happens before the first probe or when an instance names a
 * driver this build does not ship. A ready provider without account metadata
 * remains available and does not imply an authentication failure.
 */
export function getProviderSummary(provider: ServerProvider | undefined) {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation and authentication details.",
    };
  }
  if (!provider.enabled || provider.status === "disabled") {
    return {
      headline: "Disabled",
      detail:
        provider.message ?? "This provider is installed but disabled for new sessions in T3 Code.",
    };
  }
  if (!provider.installed) {
    return {
      headline: "Not found",
      detail: provider.message ?? "CLI not detected on PATH.",
    };
  }
  if (provider.auth.status === "unauthenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Not authenticated · ${authLabel}` : "Not authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : "Authenticated",
      detail: provider.message ?? null,
    };
  }
  return {
    headline: "Available",
    detail: provider.message ?? null,
  };
}

/**
 * Normalize a version string for display. Adds the `v` prefix when the
 * driver reported a bare version (e.g. `1.2.3`) so cards render
 * consistently regardless of driver.
 */
export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  // Antigravity reports a release tag such as `agy_acp_server_20260818_01_RC01`.
  // Show the date and candidate so the row title keeps room for the name.
  const antigravity = /^agy_acp_server_(\d{4})(\d{2})(\d{2})_\d+(?:_(\w+))?$/.exec(version);
  if (antigravity) {
    const [, year, month, day, candidate] = antigravity;
    return `${year}-${month}-${day}${candidate ? ` ${candidate}` : ""}`;
  }
  // Only bare semver-like versions get a `v` prefix. Other tags are shown as-is.
  return /^\d/.test(version) ? `v${version}` : version;
}

const COMPATIBILITY_TITLES = {
  graceful: "Limited support",
  unsupported: "Unsupported version",
  broken: "Known broken version",
} as const;

/** Compatibility guidance shares the version popover, with safe install actions. */
export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
  compatibility?: ServerProviderCompatibilityAdvisory | undefined,
  showCompatibility = true,
): {
  readonly title: string;
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
  readonly targetVersion: string | null;
} | null {
  const latestIsIncompatible =
    compatibility?.latestVersionStatus === "broken" ||
    compatibility?.latestVersionStatus === "unsupported";
  if (
    showCompatibility &&
    compatibility &&
    (compatibility.status === "graceful" ||
      compatibility.status === "unsupported" ||
      compatibility.status === "broken")
  ) {
    const targetVersion = compatibility.recommendedVersion;
    const recommendation = getProviderVersionLabel(targetVersion) ?? compatibility.recommendedRange;
    return {
      title: COMPATIBILITY_TITLES[compatibility.status],
      detail:
        compatibility.message ??
        (recommendation ? `Use ${recommendation} for full support.` : "Update for full support."),
      updateCommand:
        targetVersion || latestIsIncompatible ? null : (advisory?.updateCommand ?? null),
      emphasis: compatibility.status === "graceful" ? "normal" : "strong",
      targetVersion,
    };
  }
  if (
    !advisory ||
    advisory.status === "current" ||
    advisory.status === "unknown" ||
    latestIsIncompatible
  ) {
    return null;
  }

  const label = "Update available";
  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    title: label,
    detail:
      advisory.message ??
      (versionLabel
        ? `${label}: install ${versionLabel}.`
        : `${label}: install the latest provider version.`),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
    targetVersion: null,
  };
}

/** A provider as `ConnectionStatus` says it, with the plan it runs on. */
export interface ProviderConnection {
  readonly state: ConnectionState;
  /** Where the state's own label would say too little ("Checking…", "Needs attention"). */
  readonly label?: string;
  readonly detail?: string;
  /** What is left to do, for a provider that needs setup. */
  readonly step?: ConnectionStep;
}

/** A provider is set up in two steps: install it, then sign in. */
const SETUP_STEP_COUNT = 2;

/**
 * The first question a provider answers no to, in the order the status language asks them: is it
 * here (this build knows it), is it turned on, is it set up (installed, then signed in), does it
 * work. Setup comes before a problem because a provider that is not signed in fails its checks for
 * that reason alone, and the person's next step is to sign in.
 */
export function providerConnection(
  provider: ServerProvider | undefined,
  enabled: boolean,
): ProviderConnection {
  if (provider === undefined) {
    return {
      state: "unavailable",
      label: "Checking\u2026",
      detail: "Waiting for the server to report installation and sign-in.",
    };
  }
  if (!isProviderAvailable(provider)) {
    return {
      state: "unavailable",
      detail: provider.unavailableReason ?? "This build does not include this provider.",
    };
  }
  if (!enabled || !provider.enabled || provider.status === "disabled") {
    return { state: "off", detail: "Turned off for new chats." };
  }
  if (!provider.installed) {
    return {
      state: "setup",
      step: { n: 1, of: SETUP_STEP_COUNT, title: "install it" },
      ...(provider.message === undefined ? {} : { detail: provider.message }),
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      state: "setup",
      step: { n: 2, of: SETUP_STEP_COUNT, title: "sign in" },
      ...(provider.message === undefined ? {} : { detail: provider.message }),
    };
  }
  if (provider.status === "error") {
    return {
      state: "problem",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  if (provider.status === "warning") {
    return {
      state: "problem",
      label: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  // The plan it runs on, as the provider words it. The version is the header's to add: a list
  // already shows it beside the name.
  const plan = provider.auth.label ?? provider.auth.type;
  return { state: "connected", ...(plan === undefined ? {} : { detail: plan }) };
}

export type ReadinessMark = "yes" | "no" | "unknown";

/** One thing a provider needs before Peer can start an agent on it, as the status states it. */
export interface ReadinessCheck {
  readonly id: "installed" | "signed-in" | "runs";
  readonly mark: ReadinessMark;
  readonly what: string;
  readonly detail: string;
}

/**
 * "Ready for Peer", from the facts the provider status holds and no others: that the program is
 * installed, that it is signed in (and to which plan), and that its last check passed. A provider
 * that is not signed in or fails its check says why in the server's words.
 */
export function providerReadiness(
  provider: ServerProvider | undefined,
  enabled: boolean,
): ReadonlyArray<ReadinessCheck> {
  if (provider === undefined) {
    const waiting = "Waiting for the server to report.";
    return [
      { id: "installed", mark: "unknown", what: "Installed", detail: waiting },
      { id: "signed-in", mark: "unknown", what: "Signed in", detail: waiting },
      { id: "runs", mark: "unknown", what: "Starts on this computer", detail: waiting },
    ];
  }
  // "Version 0.47.0": the label's own "v" prefix would read twice.
  const version = getProviderVersionLabel(provider.version)?.replace(/^v(?=\d)/, "") ?? null;
  const installed: ReadinessCheck = provider.installed
    ? {
        id: "installed",
        mark: "yes",
        what: "Installed",
        detail:
          version === null
            ? "Found on this computer."
            : `Version ${version}, found on this computer.`,
      }
    : {
        id: "installed",
        mark: "no",
        what: "Installed",
        detail: provider.message ?? "Not found on this computer.",
      };
  const plan = provider.auth.label ?? provider.auth.type;
  const signedIn: ReadinessCheck =
    provider.auth.status === "authenticated"
      ? {
          id: "signed-in",
          mark: "yes",
          what: "Signed in",
          detail:
            plan === undefined
              ? "As the provider reports it."
              : `${plan}, as the provider reports it.`,
        }
      : provider.auth.status === "unauthenticated"
        ? {
            id: "signed-in",
            mark: "no",
            what: "Signed in",
            detail: provider.installed
              ? (provider.message ?? "Not signed in. Sign in below.")
              : "Install it first.",
          }
        : {
            id: "signed-in",
            mark: "unknown",
            what: "Signed in",
            detail: "This provider does not say who is signed in.",
          };
  const runs: ReadinessCheck =
    !enabled || !provider.enabled || provider.status === "disabled"
      ? {
          id: "runs",
          mark: "unknown",
          what: "Starts on this computer",
          detail: "Turned off for new chats.",
        }
      : !provider.installed || provider.auth.status === "unauthenticated"
        ? {
            id: "runs",
            mark: "unknown",
            what: "Starts on this computer",
            detail: "Checked once it is installed and signed in.",
          }
        : provider.status === "ready"
          ? {
              id: "runs",
              mark: "yes",
              what: "Starts on this computer",
              detail: "Its last check passed.",
            }
          : {
              id: "runs",
              mark: "no",
              what: "Starts on this computer",
              detail:
                provider.message ??
                (provider.status === "error"
                  ? "The provider failed its startup checks."
                  : "The server could not fully verify it."),
            };
  return [installed, signedIn, runs];
}
