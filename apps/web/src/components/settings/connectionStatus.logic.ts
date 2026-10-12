/**
 * One status language for everything Peer connects to — the Hub and its features, Slack, GitHub
 * checks, webhooks, plugins, source control and providers. A connection answers three questions in
 * order: is it available here, is it turned on, is it connected? Its state is the first question
 * without a yes, or a problem with something that used to work.
 */
export type ConnectionState = "unavailable" | "off" | "setup" | "connected" | "problem";

export const CONNECTION_STATE_LABEL: Readonly<Record<ConnectionState, string>> = {
  unavailable: "Not available",
  off: "Off",
  setup: "Needs setup",
  connected: "Connected",
  problem: "Problem",
};

/** Where a setup stands: "Step 3 of 4: verify the stored token". */
export interface ConnectionStep {
  readonly n: number;
  readonly of: number;
  readonly title: string;
}

/** The line after the label: the setup step when there is one, else the detail. */
export function connectionDetail(input: {
  readonly detail?: string | undefined;
  readonly step?: ConnectionStep | undefined;
}): string | undefined {
  if (input.step !== undefined) {
    return `Step ${input.step.n} of ${input.step.of}: ${input.step.title}`;
  }
  return input.detail === undefined || input.detail === "" ? undefined : input.detail;
}

/** Whether the state asks the person to do something, as Settings › Overview counts it. */
export function connectionNeedsAttention(state: ConnectionState): boolean {
  return state === "setup" || state === "problem";
}
