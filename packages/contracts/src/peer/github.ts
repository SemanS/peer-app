import * as Schema from "effect/Schema";

/**
 * GitHub on this computer, through GitHub CLI: workspace repositories on
 * github.com clone with its account, and Peer signs in to it from the app.
 */
export const PeerGitHubState = Schema.Struct({
  /** GitHub CLI (`gh`) is installed. */
  cli: Schema.Boolean,
  /** GitHub CLI's active account on github.com, which clones use. */
  account: Schema.NullOr(Schema.String),
  /** A sign-in waiting for the person to enter this code at this address. */
  signIn: Schema.NullOr(Schema.Struct({ userCode: Schema.String, verificationUri: Schema.String })),
  /** Why the last sign-in failed. */
  error: Schema.NullOr(Schema.String),
});
export type PeerGitHubState = typeof PeerGitHubState.Type;
