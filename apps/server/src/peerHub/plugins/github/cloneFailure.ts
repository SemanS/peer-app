/**
 * Why a clone from github.com failed, naming the GitHub account it signed in with.
 *
 * @module peerHub/plugins/github/cloneFailure
 */
import { explainCloneFailure, type CloneTarget } from "../../cloneFailure.ts";

export interface GitHubCloneTarget extends CloneTarget {
  /** `owner/repo` */
  readonly nameWithOwner: string;
  /** GitHub CLI's account the clone signed in with; null when git used its own sign-in. */
  readonly account: string | null;
  /** GitHub CLI is installed, so Peer can sign in to GitHub. */
  readonly cli: boolean;
}

/**
 * A failed clone from github.com: GitHub answers "not found" for a private
 * repository the account may not open, so a refusal of any kind means the
 * account, and signing in with one that can open it fixes it.
 */
export function explainGitHubCloneFailure(
  output: string,
  target: GitHubCloneTarget,
): { readonly message: string; readonly signIn: boolean } {
  const refused =
    /could not read (username|password)|terminal prompts disabled|authentication failed|repository not found|repository '[^']*' not found|permission denied \(publickey/i.test(
      output,
    );
  if (!refused) return { message: explainCloneFailure(output, target), signIn: false };
  const repository = target.nameWithOwner;
  if (target.account !== null) {
    return {
      signIn: true,
      message: `GitHub account ${target.account} cannot open ${repository}. Ask its owner to add ${target.account}, or connect the GitHub account that can.`,
    };
  }
  return {
    signIn: true,
    message: target.cli
      ? `Connect GitHub with an account that can open ${repository}.`
      : `To clone ${repository}, install GitHub CLI (brew install gh) and connect GitHub here, or sign git in to GitHub with an account that can open it.`,
  };
}
