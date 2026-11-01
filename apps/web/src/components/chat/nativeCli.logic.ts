import { readCodexSetupMode } from "../settings/CodexSetupSection.logic";

export type NativeCliAgent = "Claude Code" | "Codex";

export type NativeCliOperation = "continue" | "fork" | "return";

export function nativeCliAgentForDriver(driver: string): NativeCliAgent | null {
  if (driver === "claudeAgent") return "Claude Code";
  if (driver === "codex") return "Codex";
  return null;
}

/**
 * The CLI a thread can go to, or null when the server would refuse it. A managed Codex instance
 * reaches its model through a gateway that only exists in a Peer session. When the environment's
 * settings are not readable the config is undefined and the server's refusal says why instead.
 */
export function resolveNativeCliAgent(input: {
  readonly nativeThreadRef: { readonly driver: string; readonly nativeId: string | null } | null;
  readonly instanceConfig: unknown;
}): NativeCliAgent | null {
  const ref = input.nativeThreadRef;
  // Pending ids stand in until the provider reports its session.
  if (ref === null || ref.nativeId === null || ref.nativeId.startsWith("pending:")) return null;
  const agent = nativeCliAgentForDriver(ref.driver);
  if (agent === "Codex" && readCodexSetupMode(input.instanceConfig) === "managed") return null;
  return agent;
}

export function nativeCliProgressTitle(operation: NativeCliOperation, agent: NativeCliAgent) {
  switch (operation) {
    case "continue":
      return `Opening ${agent}`;
    case "fork":
      return `Forking into ${agent}`;
    case "return":
      return "Bringing the thread back to Peer";
  }
}

const CODEX_HOLD_NOTE =
  "Codex holds a session for about a minute after it closes, and Peer waits for it.";

export function nativeCliProgressDescription(operation: NativeCliOperation, agent: NativeCliAgent) {
  const holdNote = agent === "Codex" && operation !== "fork" ? ` ${CODEX_HOLD_NOTE}` : "";
  return operation === "return"
    ? `Reading what happened in ${agent}.${holdNote}`
    : `The first time, Peer installs what it needs to read the session. That can take a few minutes.${holdNote}`;
}

/** Stays on screen after the CLI quit, for as long as Peer waits to read the session back. */
export function nativeCliLoanDescription(agent: NativeCliAgent) {
  const returns = `Peer runs nothing here until it comes back. Quit ${agent} and it returns by itself`;
  return agent === "Codex" ? `${returns}, about a minute later. ${CODEX_HOLD_NOTE}` : `${returns}.`;
}

/**
 * A terminal whose command never arrived keeps its shell, and a loan cannot end while its terminal
 * lives. So the terminal goes first, and only a failed return is left to the caller.
 */
export async function releaseUnusedLoan<A>(steps: {
  readonly closeTerminal: () => Promise<unknown>;
  readonly returnFromCli: () => Promise<A>;
}): Promise<A> {
  await steps.closeTerminal().catch(() => undefined);
  return steps.returnFromCli();
}

export function nativeCliFailureTitle(operation: NativeCliOperation, agent: NativeCliAgent) {
  switch (operation) {
    case "continue":
      return `Could not continue in ${agent}`;
    case "fork":
      return `Could not fork into ${agent}`;
    case "return":
      return "Could not return to Peer";
  }
}
