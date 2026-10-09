/**
 * The GitHub plugin: workspace repositories on github.com clone and pull with GitHub CLI's account,
 * a person signs GitHub CLI in from the app, and a work's pull requests come from GitHub. It needs
 * no Hub feature.
 *
 * @module peerHub/plugins/github
 */
import { GitHubRpcGroup, PEER_GITHUB_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

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
  layer: GitHub.layer,
  make: Effect.gen(function* () {
    const github = yield* GitHub.GitHub;
    const status = yield* PeerStatus.PeerStatus;
    return {
      gitHost: github.host,
      status: { read: github.state },
      rpc: {
        group: GitHubRpcGroup,
        handlers: (wrap) =>
          GitHubRpcGroup.of({
            [PEER_GITHUB_METHODS.peerHubConnectGitHub]: (_input) =>
              wrap.effect(PEER_GITHUB_METHODS.peerHubConnectGitHub, github.connect, TRACE),
            [PEER_GITHUB_METHODS.peerHubCancelGitHubSignIn]: (_input) =>
              wrap.effect(PEER_GITHUB_METHODS.peerHubCancelGitHubSignIn, github.cancel, TRACE),
          }),
      },
      // GitHub CLI is read again as GitHub turns on; a sign-in still waiting ends as it turns off.
      run: Effect.addFinalizer(() => github.stop).pipe(
        Effect.andThen(github.refresh),
        Effect.andThen(status.publish),
        Effect.andThen(Effect.never),
      ),
    } satisfies PeerContributions;
  }),
});
