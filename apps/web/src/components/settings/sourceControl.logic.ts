/**
 * What the Source Control page and Settings › Overview say of each version control tool and hosting
 * integration the environment found, in the status language: Connected (signed in), Needs setup
 * (installed, not signed in), Off (not installed), Not available (not built yet), Problem (Peer
 * could not tell). Pure, so both pages tell the same thing.
 */
import type { SourceControlProviderDiscoveryItem, VcsDiscoveryItem } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionView } from "./connectionFacts";

export type SourceControlDiscoveryItem = VcsDiscoveryItem | SourceControlProviderDiscoveryItem;

export function isProviderItem(
  item: SourceControlDiscoveryItem,
): item is SourceControlProviderDiscoveryItem {
  return "auth" in item;
}

/** A version control system the app lists but does not drive yet. */
export const isVcsNotReady = (item: SourceControlDiscoveryItem): boolean =>
  !isProviderItem(item) && !item.implemented;

export interface SourceControlStatus {
  readonly connection: ConnectionView;
  /**
   * The account a connected tool is signed in as. The page shows it after "Signed in as" and keeps
   * it hidden until revealed, so it stays out of the sentence.
   */
  readonly account: string | null;
}

/**
 * The oldest jj Peer works with: the server's `JJ_MINIMUM_VERSION`, which the web bundle cannot
 * import. Discovery reports any installed jj as available, so the floor is judged here.
 */
const JJ_MINIMUM_VERSION = "0.46.0";

/** Whether `jj --version`'s first line ("jj 0.45.0-…") is below the floor; unreadable is not. */
function jjBelowFloor(version: string | null): boolean {
  const found = version === null ? null : /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (found === null) return false;
  const floor = JJ_MINIMUM_VERSION.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const part = Number(found[index + 1]);
    const least = floor[index] ?? 0;
    if (part !== least) return part < least;
  }
  return false;
}

/** The sentence for a hosting CLI that is installed and signed out. */
function signInSentence(item: SourceControlProviderDiscoveryItem): string {
  return item.executable === undefined
    ? "Sign in with an access token or an API token."
    : `Sign in with the ${item.executable} tool on the server host to turn on change requests.`;
}

/**
 * One tool's status. Not installed is Off: nobody turned it on, so nothing is left to do. An
 * installed hosting CLI that is signed out Needs setup; an API integration (no CLI) without
 * credentials needs them. When Peer could not verify the sign-in it is a Problem, with what it knows.
 * An installed jj below the floor Needs setup: Peer leaves its repositories alone until it is updated.
 */
export function sourceControlStatus(item: SourceControlDiscoveryItem): SourceControlStatus {
  const none = { account: null } as const;
  if (isVcsNotReady(item)) {
    return {
      ...none,
      connection: { state: "unavailable", detail: `Support for ${item.label} is coming soon.` },
    };
  }
  if (item.status !== "available") {
    const floor =
      !isProviderItem(item) && item.kind === "jj"
        ? ` Peer needs ${JJ_MINIMUM_VERSION} or newer.`
        : "";
    return {
      ...none,
      connection: { state: "off", detail: `Not installed. ${item.installHint}${floor}` },
    };
  }
  if (!isProviderItem(item) && item.kind === "jj" && jjBelowFloor(Option.getOrNull(item.version))) {
    return {
      ...none,
      connection: {
        state: "setup",
        detail: `Jujutsu repositories need jj ${JJ_MINIMUM_VERSION} or newer. Update it with \`brew upgrade jj\` or from https://github.com/jj-vcs/jj.`,
      },
    };
  }
  if (!isProviderItem(item)) {
    return { ...none, connection: { state: "connected", label: "Installed" } };
  }
  switch (item.auth.status) {
    case "authenticated":
      return {
        connection: { state: "connected", detail: "Signed in" },
        account: Option.getOrNull(item.auth.account),
      };
    case "unauthenticated":
      return { ...none, connection: { state: "setup", detail: signInSentence(item) } };
    case "unknown":
      return {
        ...none,
        connection: {
          state: "problem",
          detail: `Could not verify ${item.label}. ${Option.getOrElse(item.auth.detail, () => item.installHint)}`,
        },
      };
  }
}
