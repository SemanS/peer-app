/** The broker, generated shim and Peer Mod share this command outcome contract. */
export const EXIT_STATUS = {
  done: 0,
  usage: 2,
  refused: 3,
  uncertain: 4,
  "not running": 5,
} as const;
export const HTTP_STATUS = { done: 200, usage: 400, refused: 409, uncertain: 500 } as const;
export type CliOutcome = "usage" | "refused" | "uncertain";

export const TEXT = {
  notRunning:
    "peer: not running: Peer is not running on this computer, or this shell cannot reach its socket; nothing was sent.",
  start:
    "ask your person to start Peer (or let this shell reach its socket), then repeat the command.",
  uncertain: "peer: uncertain: %s, so peer %s may or may not have taken effect.",
  check: "run peer status to see whether it did, and repeat the command only if it did not.",
  repeat: "repeat the same command; its operation id makes a second send do nothing.",
  timeout: "Peer did not answer within %s s",
  lost: "the connection to Peer was lost",
  broker: "Peer failed while running the command",
  hub: "the Hub gave no usable answer",
  temp: "peer: refused: could not prepare a private response directory; nothing was sent.",
  tempNext: "check that this shell can write to its temporary directory, then repeat the command.",
  name: "peer: usage: %s is not a command name.",
  help: "run peer help for the commands.",
} as const;

const sentence = (reason: string) => (/[.!?]$/.test(reason) ? reason : `${reason}.`);

export class CliError extends Error {
  readonly status: number;
  readonly outcome: CliOutcome;
  readonly reason: string;
  readonly next: string;
  constructor(outcome: CliOutcome, reason: string, next: string) {
    super(reason);
    this.name = "CliError";
    this.outcome = outcome;
    this.reason = reason;
    this.next = next;
    this.status = HTTP_STATUS[outcome];
  }
}
export const usage = (reason: string, next: string) => new CliError("usage", reason, next);
export const refused = (reason: string, next: string) => new CliError("refused", reason, next);
export const uncertain = (command: string, cause: string = TEXT.broker, next?: string) =>
  new CliError(
    "uncertain",
    `${cause}, so peer ${command} may or may not have taken effect.`,
    next ?? (command === "request" ? TEXT.repeat : TEXT.check),
  );
export const render = (error: CliError) =>
  `peer: ${error.outcome}: ${sentence(error.reason)}\nNext: ${error.next}`;
export const notRunning = () => `${TEXT.notRunning}\nNext: ${TEXT.start}`;

/** A Hub error proves rejection only when it explicitly says nothing was applied. */
export function hubFailure(error: unknown, command: string, next: string, read = false): CliError {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "Sign in first." || detail === "Your session with the hub ended. Sign in again.")
    return refused(detail, "ask your person to sign in to Peer, then repeat the command.");
  return read ||
    (typeof error === "object" && error !== null && "refused" in error && error.refused === true)
    ? refused(detail, next)
    : uncertain(command, TEXT.hub, command === "context" ? next : undefined);
}

export async function hubWrite<A>(
  command: string,
  call: () => Promise<A>,
  next: string,
  applied = false,
): Promise<A> {
  try {
    return await call();
  } catch (error) {
    const failure = hubFailure(error, command, next);
    throw applied && failure.outcome === "refused"
      ? uncertain(command, "the Hub refused a later step after earlier steps took effect")
      : failure;
  }
}
export async function hubRead<A>(
  command: string,
  call: () => Promise<A>,
  next: string,
): Promise<A> {
  try {
    return await call();
  } catch (error) {
    throw hubFailure(error, command, next, true);
  }
}
