/**
 * What the status pages pass around: a connection as the status language says it (the props of
 * `ConnectionStatus` as plain data), and a fact a page has read, which is not there yet, failed,
 * or has its value. A page says "Checking…" for a fact that is not there yet and "Problem" only
 * for one that failed; it never guesses.
 */
import type { ConnectionState, ConnectionStep } from "./connectionStatus.logic";

/** One connection's status: what `ConnectionStatus` draws. */
export interface ConnectionView {
  readonly state: ConnectionState;
  /** The badge's word when it says more than the state ("Waiting", "Allowed"). */
  readonly label?: string | undefined;
  /** What follows the badge; the step wins over it. */
  readonly detail?: string | undefined;
  readonly step?: ConnectionStep | undefined;
  /** An ISO time: when the other side last answered. */
  readonly checkedAt?: string | undefined;
}

/** The word for a connection whose facts have not arrived. */
export const CHECKING_LABEL = "Checking…";

/** The view of a connection whose facts have not arrived: neither on nor off yet. */
export const CHECKING: ConnectionView = { state: "off", label: CHECKING_LABEL };

export type Fact<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly value: T };

export const LOADING: Fact<never> = { kind: "loading" };
export const readyFact = <T>(value: T): Fact<T> => ({ kind: "ready", value });
export const failedFact = (message: string): Fact<never> => ({ kind: "failed", message });

/**
 * A query's answer as a fact. A failure outranks the data it kept from an earlier read, as
 * everywhere in settings: a page that cannot refresh says so instead of showing what was true once.
 */
export function factOfQuery<T>(query: {
  readonly data: T | null;
  readonly error: string | null;
}): Fact<T> {
  if (query.error !== null) return failedFact(query.error);
  return query.data === null ? LOADING : readyFact(query.data);
}

/** Whether a view asks the person to finish or fix something under way, as the navigation counts it. */
export function isUnderway(view: ConnectionView): boolean {
  return view.state === "problem" || (view.state === "setup" && view.step !== undefined);
}
