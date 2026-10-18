/**
 * The jujutsu plugin's client logic, for web and the phone alike: how jj's state reads in Settings
 * and on the pages that need a checkout, who took each step of the operation log, how Peer's own
 * steps group, and what the undo dialog says. The environment parses jj; none of this runs jj.
 *
 * @module peer/jujutsu
 */
import {
  PEER_JUJUTSU_MIN_VERSION,
  WS_METHODS,
  type EnvironmentId,
  type JujutsuOperation,
  type JujutsuPlace,
  type JujutsuState,
  type UndoPreview,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";

/**
 * The plugin's atoms, spread into the server atoms: the operation log and a read-only view at one
 * operation (read whenever opened, kept no longer than watched, since the log changes with every
 * step), and what a person does from the Operations page and from a pair's card. Undo and the
 * moves are the app's only way in: no agent tool reaches them.
 */
export function createPeerJujutsuAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  const operations = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:jujutsu:operations",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: (input: JujutsuPlace) => request(WS_METHODS.peerJujutsuOperations, input),
  });
  const atOp = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:jujutsu:at-op",
    staleTimeMs: Infinity,
    idleTtlMs: 60_000,
    execute: (input: JujutsuPlace & { readonly operation: string }) =>
      request(WS_METHODS.peerJujutsuAtOp, input),
  });
  return {
    peerJujutsuOperations: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: JujutsuPlace;
    }) => operations({ environmentId: target.environmentId, input: target.input }),
    /** The project's changes right after one operation; an operation never changes, so it is kept. */
    peerJujutsuAtOp: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: JujutsuPlace & { readonly operation: string };
    }) => atOp({ environmentId: target.environmentId, input: target.input }),
    peerJujutsuPreviewUndo: createEnvironmentRpcCommand(runtime, {
      label: "peer:jujutsu:preview-undo",
      tag: WS_METHODS.peerJujutsuPreviewUndo,
    }),
    peerJujutsuUndo: createEnvironmentRpcCommand(runtime, {
      label: "peer:jujutsu:undo",
      tag: WS_METHODS.peerJujutsuUndo,
    }),
    peerJujutsuFollow: createEnvironmentRpcCommand(runtime, {
      label: "peer:jujutsu:follow",
      tag: WS_METHODS.peerJujutsuFollow,
    }),
    peerJujutsuIntegrate: createEnvironmentRpcCommand(runtime, {
      label: "peer:jujutsu:integrate",
      tag: WS_METHODS.peerJujutsuIntegrate,
    }),
    peerJujutsuConverge: createEnvironmentRpcCommand(runtime, {
      label: "peer:jujutsu:converge",
      tag: WS_METHODS.peerJujutsuConverge,
    }),
    peerJujutsuConfigure: createEnvironmentRpcCommand(runtime, {
      label: "peer:jujutsu:configure",
      tag: WS_METHODS.peerJujutsuConfigure,
    }),
  };
}

/** The word Settings and the pages use for jj's state, in Peer's connection words. */
export type JujutsuWord = "Connected" | "Off" | "Not available" | "Problem";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function jujutsuWord(state: JujutsuState | undefined): JujutsuWord {
  if (state === undefined) return "Off";
  switch (state.connection) {
    case "connected":
      return "Connected";
    case "notAvailable":
      return state.problem === "tooOld" ? "Problem" : "Not available";
    case "problem":
      return "Problem";
    default:
      return "Off";
  }
}

/** Settings › This computer: "Connected · jj 0.46.0 · 2 agent workspaces". */
export function jujutsuSettingsLine(state: JujutsuState | undefined): string {
  const word = jujutsuWord(state);
  if (state === undefined || word !== "Connected") return word;
  const parts: string[] = [word];
  if (state.version !== undefined) parts.push(`jj ${state.version}`);
  parts.push(plural(state.agentWorkspaces, "agent workspace", "agent workspaces"));
  return parts.join(" · ");
}

/** What a page that needs a jj checkout says when it does not have one: the cause and the fix. */
export interface JujutsuProblemNote {
  readonly kind: "missing" | "tooOld" | "notColocated";
  readonly word: "Not available" | "Problem";
  readonly title: string;
  readonly body: string;
  /** A command to copy; Peer converts and installs nothing itself. */
  readonly fix: string;
}

/**
 * The problem that keeps jj from reading a project's checkout, or null. A project that is not
 * colocated is named by `state.notColocated`; a missing or old jj is every project's problem.
 */
export function jujutsuProblem(
  state: JujutsuState | undefined,
  project?: string,
): JujutsuProblemNote | null {
  if (state === undefined || state.connection === "off") return null;
  if (state.problem === "missing") {
    return {
      kind: "missing",
      word: "Not available",
      title: "Jujutsu is not on this computer",
      body: `This project's checkout is a jj repository, and Peer needs jj ${PEER_JUJUTSU_MIN_VERSION} or newer to read it. Git projects are not affected.`,
      fix: "brew install jj",
    };
  }
  if (state.problem === "tooOld") {
    return {
      kind: "tooOld",
      word: "Problem",
      title: `jj ${state.version ?? "(unknown version)"} is older than Peer needs`,
      body: `Changes, building on a teammate's change and read-only protection need jj ${PEER_JUJUTSU_MIN_VERSION}. Until then this checkout shows as unsupported, and Peer writes nothing into it.`,
      fix: "brew upgrade jj",
    };
  }
  const notColocated = state.notColocated ?? [];
  if (
    state.problem === "notColocated" &&
    (project === undefined || notColocated.length === 0 || notColocated.includes(project))
  ) {
    return {
      kind: "notColocated",
      word: "Problem",
      title: "This jj repository has no .git beside it",
      body: "Peer works with colocated repositories only, and never converts one itself. Make it colocated in a terminal, or open a colocated checkout.",
      fix: "jj git colocation enable",
    };
  }
  return null;
}

/** Who took a step, read from jj's `operation.username`. */
export type OperationActor =
  | { readonly kind: "person"; readonly person: string; readonly label: string }
  | {
      readonly kind: "agent";
      readonly person: string;
      readonly agent: string;
      readonly label: string;
    }
  | { readonly kind: "peer"; readonly step: string; readonly label: string };

const titleWords = (value: string) =>
  value
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** `bob@acme.test` and `bob` both read as Bob. */
export const personName = (value: string) => titleWords(value.split("@")[0] ?? value);

/** `claude-code` reads as Claude Code, `codex` as Codex. */
export const agentName = (value: string) => titleWords(value);

const PEER_STEP_LABEL: Readonly<Record<string, string>> = {
  follow: "Peer, following",
  check: "Peer's check",
};

/** A person is `bob`, an agent `bob·codex`, Peer's own steps `peer·follow` or `peer·check`. */
export function operationActor(user: string): OperationActor {
  const [first = user, second] = user.split("·", 2);
  if (first === "peer") {
    const step = second ?? "";
    return { kind: "peer", step, label: PEER_STEP_LABEL[step] ?? "Peer" };
  }
  if (second === undefined || second.length === 0) {
    return { kind: "person", person: first, label: personName(first) };
  }
  return {
    kind: "agent",
    person: first,
    agent: second,
    label: `${personName(first)} · ${agentName(second)}`,
  };
}

/** One row of the Operations page: one step, or Peer's steps that ran together. */
export interface OperationGroup {
  /** The newest step's id: the row's identity. */
  readonly id: string;
  readonly actor: OperationActor;
  /** The newest step's time. */
  readonly time: string;
  readonly title: string;
  /** The commands that ran, oldest first. */
  readonly commands: ReadonlyArray<string>;
  readonly operations: ReadonlyArray<JujutsuOperation>;
  /** Every change the group changed, once. */
  readonly changed: ReadonlyArray<string>;
}

/** Follow steps that ran within this long of each other came from one `peer follow`. */
const FOLLOW_GAP_MS = 10_000;

const sameGroup = (newer: JujutsuOperation, older: JujutsuOperation): boolean => {
  const actor = operationActor(newer.user);
  if (actor.kind !== "peer" || newer.user !== older.user) return false;
  // A check's three jj commands are one row however long its run took; follow's are close together.
  if (actor.step === "check") return true;
  return Math.abs(Date.parse(newer.time) - Date.parse(older.time)) <= FOLLOW_GAP_MS;
};

/**
 * The log, newest first, as rows: Peer's steps that ran together in a row of their own ("Checked a
 * merge in a throwaway change"), every other step alone. Steps are grouped when they follow each
 * other in the log, since another agent's step between them is its own row.
 */
export function groupOperations(
  operations: ReadonlyArray<JujutsuOperation>,
): ReadonlyArray<OperationGroup> {
  const groups: JujutsuOperation[][] = [];
  for (const operation of operations) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    if (last !== undefined && previous !== undefined && sameGroup(previous, operation)) {
      last.push(operation);
    } else {
      groups.push([operation]);
    }
  }
  return groups.map((steps) => {
    const newest = steps[0] as JujutsuOperation;
    const actor = operationActor(newest.user);
    const alone = steps.length === 1;
    return {
      id: newest.id,
      actor,
      time: newest.time,
      title:
        !alone && actor.kind === "peer" && actor.step === "check"
          ? "Checked a merge in a throwaway change"
          : newest.description,
      commands: steps.map((_, i) => (steps[steps.length - 1 - i] as JujutsuOperation).args),
      operations: steps,
      changed: [...new Set(steps.flatMap((step) => step.changed))],
    };
  });
}

/** The page's filter: every step, one agent's, or Peer's own. */
export type OperationFilter =
  | { readonly kind: "all" }
  | { readonly kind: "peer" }
  | { readonly kind: "actor"; readonly user: string };

export function filterOperations(
  groups: ReadonlyArray<OperationGroup>,
  filter: OperationFilter,
): ReadonlyArray<OperationGroup> {
  if (filter.kind === "all") return groups;
  if (filter.kind === "peer") return groups.filter((group) => group.actor.kind === "peer");
  return groups.filter((group) => group.operations.some((step) => step.user === filter.user));
}

/** The users that took steps, for the filter's choices: Peer's steps are one choice of their own. */
export function operationActors(
  operations: ReadonlyArray<JujutsuOperation>,
): ReadonlyArray<{ readonly user: string; readonly label: string }> {
  const seen = new Map<string, string>();
  for (const operation of operations) {
    const actor = operationActor(operation.user);
    if (actor.kind !== "peer" && !seen.has(operation.user)) seen.set(operation.user, actor.label);
  }
  return [...seen].map(([user, label]) => ({ user, label }));
}

/** What the undo dialog says before anything runs. */
export interface UndoDialog {
  readonly title: string;
  /** Present when a later step touched the same changes. */
  readonly warning?: string;
  /** The later steps by name, newest last. */
  readonly later: ReadonlyArray<{ readonly id: string; readonly line: string }>;
  readonly mergeNote?: string;
  /** Peer could not read what later steps changed. */
  readonly unread?: string;
  /** The commands Peer will run, in order. Cancel runs none of them. */
  readonly commands: ReadonlyArray<string>;
}

export function undoDialog(preview: UndoPreview): UndoDialog {
  const touched = preview.later.length > 0;
  return {
    title: `Undo "${preview.operation.description}"`,
    ...(touched
      ? {
          warning:
            preview.later.length === 1
              ? "A later step touched the same change"
              : "Later steps touched the same change",
          mergeNote: "Peer will merge the two versions afterwards.",
        }
      : {}),
    later: preview.later.map((step) => ({
      id: step.id,
      line: `${operationActor(step.user).label}: ${step.description}`,
    })),
    ...(preview.changedUnread === true
      ? { unread: "Peer could not read what later steps changed. You can still undo." }
      : {}),
    commands: preview.commands,
  };
}
