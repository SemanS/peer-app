/**
 * The GitHub plugin: workspace repositories on github.com clone and pull with GitHub CLI's account,
 * a person signs GitHub CLI in from the app, and a work's pull requests come from GitHub. It needs
 * no Hub feature.
 *
 * @module peerHub/plugins/github
 */
import { GitHubRpcGroup, PEER_GITHUB_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { GitHubVerification, layer as verificationLayer } from "./status.ts";
import { hubFailure, usage } from "../../core/plugin.ts";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as GitHub from "./GitHub.ts";

/** Traced as Peer's methods always were. */
const TRACE = { "rpc.aggregate": "peerHub" } as const;

export const GitHubPlugin = bindPlugin({
  id: "github",
  title: "GitHub",
  summary: "Clone repositories on github.com with GitHub CLI's account, and follow pull requests.",
  defaultEnabled: true,
  commandNames: ["delivery"],
  layer: Layer.merge(GitHub.layer, verificationLayer),
  make: Effect.gen(function* () {
    const github = yield* GitHub.GitHub;
    const status = yield* PeerStatus.PeerStatus;
    const verification = yield* GitHubVerification;
    return {
      gitHost: github.host,
      status: {
        read: Effect.gen(function* () {
          return { ...(yield* github.state), verification: yield* verification.snapshot };
        }),
      },
      commands: [
        {
          name: "delivery",
          usage: "delivery [task]",
          summary: "this task's pull requests as GitHub confirmed them",
          run: ({ session, plain, args }) =>
            plain.length > 1 || args.some((arg) => arg.startsWith("--"))
              ? Effect.fail(usage("peer delivery [task]", "Run peer status to list tasks."))
              : verification
                  .delivery(session, plain[0] ?? "")
                  .pipe(
                    Effect.mapError((error) =>
                      hubFailure(error, "peer delivery", "Run peer status to list tasks.", true),
                    ),
                  ),
        },
      ],
      hooks: {
        sessionStart: ({ session }) => verification.start(session),
        notices: [{ wakes: false, read: ({ session }) => verification.notice(session) }],
      },
      hubChanges: { changes: ["projects", "resync"], onPing: () => verification.refresh },
      lifecycle: () => verification.refresh,
      workspaceCleanup: (event) =>
        event.kind === "left-workspace"
          ? verification.forget(event.workspace)
          : verification.clean(event.kind === "synced" ? event.workspaces.map((w) => w.slug) : []),
      turnOff: verification.reset,

      rpc: {
        group: GitHubRpcGroup,
        handlers: (wrap) =>
          GitHubRpcGroup.of({
            [PEER_GITHUB_METHODS.peerGitHubStatus]: ({ workspace }) =>
              wrap.effect(
                PEER_GITHUB_METHODS.peerGitHubStatus,
                verification.status(workspace),
                TRACE,
              ),
            [PEER_GITHUB_METHODS.peerHubConnectGitHub]: (_input) =>
              wrap.effect(PEER_GITHUB_METHODS.peerHubConnectGitHub, github.connect, TRACE),
            [PEER_GITHUB_METHODS.peerHubCancelGitHubSignIn]: (_input) =>
              wrap.effect(PEER_GITHUB_METHODS.peerHubCancelGitHubSignIn, github.cancel, TRACE),
          }),
      },
      // GitHub CLI is read again as GitHub turns on; a sign-in still waiting ends as it turns off.
      run: Effect.addFinalizer(() => github.stop).pipe(
        Effect.andThen(verification.reset),
        Effect.andThen(github.refresh),
        Effect.andThen(verification.refresh),
        Effect.andThen(status.publish),
        Effect.andThen(Effect.never),
      ),
    } satisfies PeerContributions;
  }),
});
