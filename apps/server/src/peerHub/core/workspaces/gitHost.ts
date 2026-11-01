/**
 * How git reaches a workspace repository: on github.com with GitHub CLI's active account, over
 * https; Peer never sees a token, gh hands it to git as a credential helper. Elsewhere, or without
 * GitHub CLI signed in, git signs in its own way (SSH keys, the keychain).
 */
import { parseGitHubAuthStatus } from "@t3tools/source-control-github/server/gitHubAuthStatus";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { explainCloneFailure, type CloneTarget } from "../../cloneFailure.ts";
import { gitHubRepository } from "../../workLifecycle.ts";
import { commandPath, run } from "../local.ts";

/** GitHub CLI's active account on github.com, from `gh auth status --json hosts`. */
export function activeGitHubAccount(statusJson: string): string | null {
  const { accounts } = parseGitHubAuthStatus(statusJson);
  return (
    accounts.find(
      (account) => account.host === "github.com" && account.active && account.authenticated,
    )?.account ?? null
  );
}

/** The helper git runs; `gh auth setup-git` writes the same one. */
const credentialHelper = (gh: string) => `!'${gh.replaceAll("'", "'\\''")}' auth git-credential`;

/**
 * A failed clone from github.com: GitHub answers "not found" for a private repository the account
 * may not open, so a refusal of any kind means the account.
 */
export function explainGitHubCloneFailure(
  output: string,
  target: CloneTarget & {
    /** `owner/repo` */
    readonly nameWithOwner: string;
    /** GitHub CLI's account the clone signed in with; null when git used its own sign-in. */
    readonly account: string | null;
    /** GitHub CLI is installed. */
    readonly cli: boolean;
  },
): string {
  const refused =
    /could not read (username|password)|terminal prompts disabled|authentication failed|repository not found|repository '[^']*' not found/i.test(
      output,
    );
  if (!refused) return explainCloneFailure(output, target);
  const repository = target.nameWithOwner;
  if (target.account !== null) {
    return `GitHub account ${target.account} cannot open ${repository}. Ask its owner to add ${target.account}, or run "gh auth login" in Terminal with an account that can.`;
  }
  return target.cli
    ? `Run "gh auth login" in Terminal with an account that can open ${repository}.`
    : `To clone ${repository}, install GitHub CLI (brew install gh) and run "gh auth login" in Terminal, or sign git in to GitHub another way.`;
}

/** GitHub CLI on this computer; tests put a stand-in in its place. */
export class GitHubCli extends Context.Reference<{
  /** Where GitHub CLI is installed on this computer; null when it is not. */
  readonly find: Effect.Effect<string | null>;
  /** What `gh` prints for `args`; rejects as `run` (`core/local.ts`) does. */
  readonly run: (gh: string, args: ReadonlyArray<string>) => Promise<string>;
}>("t3/peerHub/core/workspaces/gitHost/GitHubCli", {
  defaultValue: () => ({
    find: Effect.sync(() => commandPath("gh")),
    run: (gh, args) => run(gh, args),
  }),
}) {}

/** How git reaches a repository. */
export interface GitWay {
  readonly url: string;
  /** The arguments before git's command that make it sign in this way. */
  readonly args: ReadonlyArray<string>;
  /** Makes pulls and pushes in a new checkout sign in the same way. */
  readonly configure: (checkout: string) => Effect.Effect<void>;
  /** Why a clone or a read failed, in words a person can act on. */
  readonly explain: (output: string, repo: CloneTarget) => string;
}

/** git left to sign in its own way. */
const plain = (url: string, explain: GitWay["explain"]): GitWay => ({
  url,
  args: [],
  configure: () => Effect.void,
  explain,
});

/** The way for `url`, with GitHub CLI's account read again: what github.com clones sign in with. */
export const gitWay = Effect.fn("peerHub.gitWay")(function* (url: string) {
  const github = gitHubRepository(url);
  if (github === null) {
    return plain(url, explainCloneFailure);
  }
  const cli = yield* GitHubCli;
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
  const explain: GitWay["explain"] = (output, repo) =>
    explainGitHubCloneFailure(output, {
      ...repo,
      nameWithOwner: github.nameWithOwner,
      account,
      cli: gh !== null,
    });
  if (gh === null || account === null) return plain(url, explain);
  const helper = credentialHelper(gh);
  return {
    url: github.httpsUrl,
    args: ["-c", "credential.helper=", "-c", `credential.helper=${helper}`],
    configure: (checkout) =>
      Effect.tryPromise(async () => {
        const key = "credential.https://github.com.helper";
        await run("git", ["-C", checkout, "config", "--local", key, ""]);
        await run("git", ["-C", checkout, "config", "--local", "--add", key, helper]);
      }).pipe(Effect.ignoreCause({ log: true })),
    explain,
  } satisfies GitWay;
});
