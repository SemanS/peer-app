import type { PeerGitHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  GITHUB_DESCRIPTION,
  coveredRepositories,
  githubCardView,
  githubConnection,
  githubFactConnection,
} from "./integrations.logic";
import { CHECKING, failedFact, readyFact } from "../../settings/connectionFacts";

const github = (extra: Partial<PeerGitHubStatus> = {}): PeerGitHubStatus => ({
  configured: true,
  webhookPath: "/v1/workspaces/acme/github/webhook",
  lastPingAt: "2026-10-11T09:00:00Z",
  lastVerifiedAt: "2026-10-11T09:05:00Z",
  repositories: [
    { project: "booking", repository: "booking-api", github: "acme/booking-api" },
    { project: "booking", repository: "booking-web", github: "acme/booking-web" },
    { project: "peer", repository: "opera-bridge", github: "acme/opera-bridge" },
    { project: "peer", repository: "peer-hub", github: "Acme/Peer-Hub" },
    { project: "camp", repository: "peer-hub", github: "acme/peer-hub" },
    { project: "camp", repository: "legacy", github: null },
  ],
  secret: "present",
  ...extra,
});
describe("the GitHub PR checks card", () => {
  it("is connected from the first ping, with what it covers and when GitHub last pinged", () => {
    expect(githubCardView(github())).toEqual({
      connection: {
        state: "connected",
        detail: "4 repositories",
        checkedAt: "2026-10-11T09:00:00Z",
      },
      description: GITHUB_DESCRIPTION,
      canSetUp: true,
      setupLabel: "Manage",
      canTurnOff: true,
      secretMissing: false,
    });
    expect(GITHUB_DESCRIPTION).toBe(
      "When GitHub reports a pull request, its word counts over the agent’s report.",
    );
  });

  it("counts a repository once however GitHub spells it, and none outside github.com", () => {
    expect(coveredRepositories(github())).toBe(4);
    expect(coveredRepositories(github({ repositories: [] }))).toBe(0);
  });

  it("says one repository in the singular", () => {
    const view = githubCardView(
      github({ repositories: [{ project: "a", repository: "a", github: "acme/a" }] }),
    );
    expect(view.connection.detail).toBe("1 repository");
  });

  it("needs setup, at the step the wizard is on, until GitHub's first ping arrives", () => {
    const view = githubCardView(github({ lastPingAt: null }));
    expect(view.connection).toEqual({
      state: "setup",
      step: { n: 2, of: 3, title: "add the webhook in GitHub, then wait for its ping" },
    });
    expect(view).toMatchObject({ setupLabel: "Continue setup", canTurnOff: true });
  });

  it("is a problem when GitHub pinged before and the secret that signs its deliveries is gone", () => {
    const view = githubCardView(github({ secret: "missing" }));
    expect(view.connection).toEqual({
      state: "problem",
      detail: "Its secret is not stored, so GitHub’s deliveries are refused.",
    });
    expect(view).toMatchObject({ setupLabel: "Fix", secretMissing: true });
  });

  it("still warns of the missing secret while the checks wait for their first ping", () => {
    const view = githubCardView(github({ secret: "missing", lastPingAt: null }));
    expect(view.connection.state).toBe("setup");
    expect(view.secretMissing).toBe(true);
  });

  it("is off before the checks are set up, and offers setup but no turning off", () => {
    const view = githubCardView(github({ configured: false, lastPingAt: null }));
    expect(view).toMatchObject({
      connection: { state: "off", detail: "Agents can’t prove a merge yet." },
      canSetUp: true,
      setupLabel: "Set up",
      canTurnOff: false,
      secretMissing: false,
    });
  });

  it("is not available on a Hub that does not check pull requests, and offers nothing", () => {
    expect(githubCardView(github({ unsupported: true, configured: false }))).toMatchObject({
      connection: {
        state: "unavailable",
        detail: "This Hub does not verify pull requests with GitHub.",
      },
      description: "This Hub does not verify pull requests with GitHub.",
      canSetUp: false,
      canTurnOff: false,
    });
  });

  it("tells the same connection to every page that shows it", () => {
    expect(githubConnection(github({ configured: false })).state).toBe("off");
    expect(githubConnection(github()).state).toBe("connected");
    expect(githubFactConnection(readyFact(github()))).toEqual(githubConnection(github()));
  });

  it("says Checking… until the status is read, and a problem only when the read failed", () => {
    expect(githubFactConnection({ kind: "loading" })).toBe(CHECKING);
    expect(githubFactConnection(failedFact("The Hub refused."))).toEqual({
      state: "problem",
      detail: "The Hub refused.",
    });
  });
});
