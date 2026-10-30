import type {
  PeerHubError,
  PeerUsageOverviewAnswer,
  PeerUsageOverviewInput,
  PeerUsageReportInput,
  PeerUsageSetSharingInput,
  PeerUsageSharingAnswer,
  PeerUsageSharingInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { usageHub, type UsageReportOutcome } from "./hub.ts";

export class PeerUsageService extends Context.Service<
  PeerUsageService,
  {
    readonly overview: (
      input: PeerUsageOverviewInput,
    ) => Effect.Effect<PeerUsageOverviewAnswer, PeerHubError>;
    readonly sharing: (
      input: PeerUsageSharingInput,
    ) => Effect.Effect<PeerUsageSharingAnswer, PeerHubError>;
    /** The person's own choice; turned on, it also wakes the reporter (`sharingTurnedOn`). */
    readonly setSharing: (
      input: PeerUsageSetSharingInput,
    ) => Effect.Effect<PeerUsageSharingAnswer, PeerHubError>;
    /** Sends one computer's report for one project and day. */
    readonly report: (
      input: PeerUsageReportInput,
    ) => Effect.Effect<UsageReportOutcome, PeerHubError>;
    /**
     * Waits for the next workspace in which this person turned sharing on here, so the reporter
     * runs a pass at once. Turning it off erased the rows, so whatever the reporter remembers
     * having sent to that workspace no longer holds.
     */
    readonly sharingTurnedOn: Effect.Effect<string>;
  }
>()("t3/peerHub/plugins/usage/service/PeerUsageService") {}

const make = Effect.gen(function* () {
  const hub = usageHub(yield* PeerHubClient.PeerHubClient);
  // Workspaces, not a bare signal: the reporter forgets what it sent per workspace. People's
  // clicks are all that fill it, and a turn-on made before a reporter runs must not be lost.
  const turnedOn = yield* Queue.unbounded<string>();
  return PeerUsageService.of({
    overview: hub.overview,
    sharing: hub.sharing,
    report: hub.report,
    setSharing: (input) =>
      hub
        .setSharing(input)
        .pipe(
          Effect.tap((answer) =>
            "sharing" in answer && answer.sharing
              ? Queue.offer(turnedOn, input.workspace)
              : Effect.void,
          ),
        ),
    sharingTurnedOn: Queue.take(turnedOn),
  });
});

export const layer = Layer.effect(PeerUsageService, make);
