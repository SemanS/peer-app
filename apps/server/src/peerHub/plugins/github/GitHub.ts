/**
 * GitHub: workspace repositories on github.com, through GitHub CLI on this computer. Clones sign in
 * with GitHub CLI's active account whatever else git keeps, and a failed clone names that account;
 * a person signs GitHub CLI in from the app with a one-time code; and a work's pull requests are
 * read with it beside the work report. While GitHub is off, clones use git's own sign-in, the
 * status shows GitHub not connected, and no pull request is looked up.
 *
 * @module peerHub/plugins/github/GitHub
 */
import { PeerHubError, type PeerGitHubState, type PeerHubStatus } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { explainCloneFailure } from "../../cloneFailure.ts";
import { run } from "../../core/local.ts";
import type { PeerGitHost } from "../../core/plugin.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { gitHubRepository } from "../../workLifecycle.ts";
import {
  activeGitHubAccount,
  GitHubCli,
  gitHubCredentialHelper,
  gitHubCredentialOptions,
  type GitHubSignIn,
} from "./client/gh.ts";
import { explainGitHubCloneFailure } from "./cloneFailure.ts";
import { WorkDeliveryTracker } from "./pullRequests.ts";

/** GitHub CLI on this computer, as last read. */
interface GitHubRuntime {
  /** Where `gh` is installed. */
  readonly cli: string | null;
  readonly account: string | null;
  readonly signIn: { readonly userCode: string; readonly verificationUri: string } | null;
  readonly error: string | null;
}

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

export class GitHub extends Context.Service<
  GitHub,
  {
    /** GitHub on this computer, as the status shows it. */
    readonly state: Effect.Effect<PeerGitHubState>;
    /** Reads GitHub CLI and its active account again. */
    readonly refresh: Effect.Effect<void>;
    /** Starts signing GitHub CLI in to GitHub; the status carries the code to enter. */
    readonly connect: Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Cancels a sign-in waiting for its code. */
    readonly cancel: Effect.Effect<PeerHubStatus>;
    /** Ends a sign-in still waiting for its code: GitHub stopped here. */
    readonly stop: Effect.Effect<void>;
    /** Clones, explains failed clones and finds pull requests for repositories on github.com. */
    readonly host: PeerGitHost;
  }
>()("t3/peerHub/plugins/github/GitHub") {}

const make = Effect.gen(function* () {
  const status = yield* PeerStatus.PeerStatus;
  const cli = yield* GitHubCli;
  const clock = yield* Clock.Clock;
  const scope = yield* Effect.scope;
  const runtime = yield* Ref.make<GitHubRuntime>({
    cli: null,
    account: null,
    signIn: null,
    error: null,
  });
  const deliveries = new WorkDeliveryTracker();
  // The sign-in GitHub CLI is waiting on, killed with the plugin if still waiting.
  let signIn: GitHubSignIn | null = null;
  yield* Effect.addFinalizer(() => Effect.sync(() => signIn?.cancel()));

  /** GitHub CLI and its active account, read again: what github.com clones sign in with. */
  const refresh = Effect.gen(function* () {
    const gh = yield* cli.find;
    const account =
      gh === null
        ? null
        : yield* Effect.tryPromise(() =>
            cli.run(gh, ["auth", "status", "--hostname", "github.com", "--json", "hosts"]),
          ).pipe(
            Effect.map(activeGitHubAccount),
            Effect.orElseSucceed(() => null),
          );
    yield* Ref.update(runtime, (s) => ({ ...s, cli: gh, account }));
    return { gh, account };
  });

  const connect: GitHub["Service"]["connect"] = Effect.gen(function* () {
    if (signIn !== null) return yield* status.publish;
    const { gh } = yield* refresh;
    if (gh === null) {
      return yield* hubError(
        "Install GitHub CLI first (brew install gh, or see cli.github.com), then connect GitHub.",
      );
    }
    const started = yield* Effect.tryPromise({
      try: () => cli.signIn(gh),
      catch: (failure) => hubError(`GitHub CLI could not start signing in: ${messageOf(failure)}`),
    });
    signIn = started;
    const { userCode, verificationUri } = started;
    yield* Ref.update(runtime, (s) => ({
      ...s,
      signIn: { userCode, verificationUri },
      error: null,
    }));
    // gh waits until the person entered the code; the account it gets is the one clones use.
    yield* Effect.gen(function* () {
      const finished = yield* Effect.tryPromise({
        try: () => started.done,
        catch: messageOf,
      }).pipe(Effect.result);
      // A cancelled or replaced sign-in leaves no error behind.
      const current = signIn === started;
      if (current) signIn = null;
      yield* Ref.update(runtime, (s) => ({
        ...s,
        signIn: current ? null : s.signIn,
        error: current && finished._tag === "Failure" ? finished.failure : s.error,
      }));
      yield* refresh;
    }).pipe(
      Effect.andThen(status.publish),
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(scope),
    );
    return yield* status.publish;
  });

  const stop: GitHub["Service"]["stop"] = Effect.gen(function* () {
    const waiting = signIn;
    signIn = null;
    waiting?.cancel();
    yield* Ref.update(runtime, (s) => ({ ...s, signIn: null }));
  });

  const host: PeerGitHost = {
    owns: (url) => gitHubRepository(url) !== null,
    address: (text) => {
      const github = gitHubRepository(text);
      return github === null ? null : { url: github.httpsUrl, name: github.name };
    },
    clone: (url) =>
      Effect.gen(function* () {
        const github = gitHubRepository(url);
        if (github === null) return null;
        // On github.com, GitHub CLI's account clones over https when it is signed in, whatever
        // else git keeps; otherwise git signs in its own way (SSH keys, the keychain).
        const { gh, account } = yield* refresh;
        if (gh === null || account === null) return null;
        return {
          url: github.httpsUrl,
          args: gitHubCredentialOptions(gh),
          // Pulls and pushes in the checkout sign in the same way.
          configure: (checkout: string) =>
            Effect.tryPromise(async () => {
              const key = "credential.https://github.com.helper";
              await run("git", ["-C", checkout, "config", "--local", key, ""]);
              await run("git", [
                "-C",
                checkout,
                "config",
                "--local",
                "--add",
                key,
                gitHubCredentialHelper(gh),
              ]);
            }).pipe(Effect.ignoreCause({ log: true })),
        };
      }),
    explain: (output, repo) => {
      const github = gitHubRepository(repo.url);
      if (github === null) return { message: explainCloneFailure(output, repo), signIn: false };
      const { cli: gh, account } = Ref.getUnsafe(runtime);
      return explainGitHubCloneFailure(output, {
        ...repo,
        nameWithOwner: github.nameWithOwner,
        account: gh === null ? null : account,
        cli: gh !== null,
      });
    },
    pullRequests: (input) => {
      const gh = Ref.getUnsafe(runtime).cli;
      return gh === null
        ? undefined
        : deliveries.read(
            input,
            (args) => cli.run(gh, args, { timeoutMs: 5000 }),
            clock.currentTimeMillisUnsafe(),
          );
    },
  };

  return GitHub.of({
    state: Effect.map(Ref.get(runtime), (s) => ({
      cli: s.cli !== null,
      account: s.account,
      signIn: s.signIn,
      error: s.error,
    })),
    refresh: Effect.asVoid(refresh),
    connect,
    cancel: stop.pipe(Effect.andThen(status.publish)),
    stop,
    host,
  });
});

export const layer = Layer.effect(GitHub, make);
