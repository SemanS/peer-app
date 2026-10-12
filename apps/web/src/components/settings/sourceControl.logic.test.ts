import type { SourceControlProviderDiscoveryItem, VcsDiscoveryItem } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { isVcsNotReady, sourceControlStatus } from "./sourceControl.logic";

const git = (extra: Partial<VcsDiscoveryItem> = {}): VcsDiscoveryItem => ({
  kind: "git",
  implemented: true,
  label: "Git",
  executable: "git",
  status: "available",
  version: Option.some("2.50.0"),
  installHint: "Install Git from https://git-scm.com/downloads.",
  detail: Option.none(),
  ...extra,
});

const provider = (
  extra: Partial<SourceControlProviderDiscoveryItem> = {},
): SourceControlProviderDiscoveryItem => ({
  kind: "github",
  label: "GitHub",
  executable: "gh",
  status: "available",
  version: Option.some("2.50.0"),
  installHint: "Install gh from https://cli.github.com.",
  detail: Option.none(),
  auth: {
    status: "authenticated",
    account: Option.some("SemanS"),
    host: Option.some("github.com"),
    detail: Option.none(),
  },
  ...extra,
});

const auth = (
  status: SourceControlProviderDiscoveryItem["auth"]["status"],
  detail: Option.Option<string> = Option.none(),
): SourceControlProviderDiscoveryItem["auth"] => ({
  status,
  account: Option.none(),
  host: Option.none(),
  detail,
});

describe("a hosting integration in the status language", () => {
  it("is Connected, signed in as the account, never 'Authenticated'", () => {
    const status = sourceControlStatus(provider());
    expect(status).toEqual({
      connection: { state: "connected", detail: "Signed in" },
      account: "SemanS",
    });
    expect(JSON.stringify(status)).not.toContain("Authenticated");
  });

  it("is Connected without an account when the tool does not name one", () => {
    const status = sourceControlStatus(provider({ auth: auth("authenticated") }));
    expect(status.connection.state).toBe("connected");
    expect(status.account).toBeNull();
  });

  it("needs setup when the CLI is installed and signed out, naming the tool to sign in with", () => {
    expect(
      sourceControlStatus(
        provider({
          kind: "gitlab",
          label: "GitLab",
          executable: "glab",
          auth: auth("unauthenticated"),
        }),
      ),
    ).toEqual({
      connection: {
        state: "setup",
        detail: "Sign in with the glab tool on the server host to turn on change requests.",
      },
      account: null,
    });
  });

  it("needs a token, not a CLI, for an integration that has no tool", () => {
    const bitbucket = provider({
      kind: "bitbucket",
      label: "Bitbucket",
      auth: auth("unauthenticated"),
    });
    const { executable: _executable, ...withoutTool } = bitbucket;
    expect(sourceControlStatus(withoutTool).connection).toEqual({
      state: "setup",
      detail: "Sign in with an access token or an API token.",
    });
  });

  it("is Off, with how to install it, when the tool is not there: nothing was turned on", () => {
    expect(
      sourceControlStatus(
        provider({
          kind: "forgejo",
          label: "Forgejo",
          executable: "tea",
          status: "missing",
          version: Option.none(),
          auth: auth("unknown"),
          installHint: "Install tea.",
        }),
      ).connection,
    ).toEqual({ state: "off", detail: "Not installed. Install tea." });
  });

  it("is a Problem, with what Peer knows, when it could not verify the sign-in", () => {
    expect(
      sourceControlStatus(provider({ auth: auth("unknown", Option.some("gh timed out.")) }))
        .connection,
    ).toEqual({ state: "problem", detail: "Could not verify GitHub. gh timed out." });
    expect(sourceControlStatus(provider({ auth: auth("unknown") })).connection.detail).toBe(
      "Could not verify GitHub. Install gh from https://cli.github.com.",
    );
  });
});

describe("a version control tool in the status language", () => {
  it("is installed when it is there and ready", () => {
    expect(sourceControlStatus(git())).toEqual({
      connection: { state: "connected", label: "Installed" },
      account: null,
    });
  });

  it("is Off when it is not installed", () => {
    expect(sourceControlStatus(git({ status: "missing" })).connection).toEqual({
      state: "off",
      detail: "Not installed. Install Git from https://git-scm.com/downloads.",
    });
  });

  it("is Not available while the app cannot drive it yet", () => {
    const jj = git({ kind: "jj", label: "Jujutsu", implemented: false });
    expect(isVcsNotReady(jj)).toBe(true);
    expect(isVcsNotReady(git())).toBe(false);
    expect(isVcsNotReady(provider())).toBe(false);
    expect(sourceControlStatus(jj).connection).toEqual({
      state: "unavailable",
      detail: "Support for Jujutsu is coming soon.",
    });
  });
});
