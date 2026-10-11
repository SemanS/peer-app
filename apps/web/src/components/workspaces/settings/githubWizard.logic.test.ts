import type { PeerGitHubStatus, PeerSettingsGitHubSetup } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  WIZARD_STEPS,
  eventsText,
  pingArrived,
  pingText,
  secretNote,
  setupFields,
  startingStep,
  worksForText,
} from "./githubWizard.logic";

const status = (extra: Partial<PeerGitHubStatus> = {}): PeerGitHubStatus => ({
  configured: true,
  webhookPath: "/v1/workspaces/acme/github/webhook",
  lastPingAt: null,
  lastVerifiedAt: null,
  repositories: [],
  ...extra,
});

const setup = (extra: Partial<PeerSettingsGitHubSetup> = {}): PeerSettingsGitHubSetup => ({
  payloadUrl: "https://hub.acme.dev/v1/github/acme",
  secret: "whsec_9Qe4tLx2Vb7nR1mK8cZ0",
  secretName: "github-webhook",
  events: "pull_request",
  ...extra,
});

describe("the steps", () => {
  it("are the design's three", () => {
    expect([...WIZARD_STEPS]).toEqual(["Turn on", "Add it in GitHub", "Wait for the ping"]);
  });

  it("start at turning on for a workspace without the checks, and at the webhook for one with", () => {
    expect(startingStep(null)).toBe(0);
    expect(startingStep(status({ configured: false }))).toBe(0);
    expect(startingStep(status({ configured: true }))).toBe(1);
  });
});

describe("what the checks cover", () => {
  it("names the repositories on github.com, once each", () => {
    expect(
      worksForText(
        status({
          repositories: [
            { project: "booking", repository: "booking-api", github: "acme/booking-api" },
            { project: "booking", repository: "booking-web", github: "acme/booking-web" },
            { project: "peer", repository: "opera-bridge", github: "acme/opera-bridge" },
            { project: "peer", repository: "peer-hub", github: "acme/peer-hub" },
            { project: "camp", repository: "peer-hub", github: "acme/peer-hub" },
          ],
        }),
      ),
    ).toBe(
      "Works for repositories on github.com: booking-api, booking-web, opera-bridge and peer-hub.",
    );
  });

  it("says what stays as reported for the ones elsewhere", () => {
    expect(
      worksForText(
        status({
          repositories: [
            { project: "booking", repository: "booking-api", github: "acme/booking-api" },
            { project: "booking", repository: "legacy", github: null },
          ],
        }),
      ),
    ).toBe(
      "Works for repositories on github.com: booking-api. The one outside github.com stays as their agents report it.",
    );
  });

  it("says so when none is on github.com", () => {
    expect(worksForText(status())).toBe(
      "None of the workspace’s repositories are on github.com yet.",
    );
    expect(
      worksForText(
        status({
          repositories: [
            { project: "a", repository: "x", github: null },
            { project: "a", repository: "y", github: null },
          ],
        }),
      ),
    ).toBe(
      "None of the workspace’s repositories are on github.com yet. The 2 outside github.com stay as their agents report them.",
    );
  });
});

describe("what GitHub is told", () => {
  it("lists the payload URL, content type, secret and events, with Copy where there is something to copy", () => {
    expect(setupFields(setup())).toEqual([
      {
        label: "Payload URL",
        value: "https://hub.acme.dev/v1/github/acme",
        copy: true,
        sealed: false,
      },
      { label: "Content type", value: "application/json", copy: false, sealed: false },
      { label: "Secret", value: "whsec_9Qe4tLx2Vb7nR1mK8cZ0", copy: true, sealed: false },
      { label: "Events", value: "Pull requests only", copy: false, sealed: false },
    ]);
  });

  it("does not show a secret the Hub keeps, and offers no Copy for it", () => {
    const secret = setupFields(setup({ secret: null }))[2];
    expect(secret).toEqual({
      label: "Secret",
      value: "Sealed as github-webhook",
      copy: false,
      sealed: true,
    });
  });

  it("writes an event name the app does not know as the Hub sent it", () => {
    expect(eventsText("pull_request")).toBe("Pull requests only");
    expect(eventsText("pull_request,push")).toBe("pull_request,push");
  });

  it("takes a secret the Hub left out as one it keeps", () => {
    const { secret: _kept, ...without } = setup();
    expect(setupFields(without)[2]).toMatchObject({ copy: false, sealed: true });
    expect(secretNote(without)).toContain("stays sealed");
    expect(setupFields(setup({ secret: "" }))[2]).toMatchObject({ copy: false, sealed: true });
  });

  it("warns that the secret is shown only now, or says it stays sealed", () => {
    expect(secretNote(setup())).toBe(
      "The secret is shown only now. Peer keeps it sealed as github-webhook.",
    );
    expect(secretNote(setup({ secret: null }))).toBe(
      "The secret stays sealed as github-webhook. Rotate it to get a new one.",
    );
  });
});

describe("waiting for the ping", () => {
  it("is over once the status has a ping it did not have when the wait began", () => {
    expect(pingArrived(null, status({ lastPingAt: null }))).toBe(false);
    expect(pingArrived(null, status({ lastPingAt: "2026-10-11T12:10:00Z" }))).toBe(true);
  });

  it("is not over for a ping from before the wait began", () => {
    const before = "2026-10-11T09:00:00Z";
    expect(pingArrived(before, status({ lastPingAt: before }))).toBe(false);
    expect(pingArrived(before, status({ lastPingAt: "2026-10-11T12:10:00Z" }))).toBe(true);
  });

  it("says which workspace GitHub pinged from and when", () => {
    const clock = () => "12:10";
    expect(pingText("acme", "2026-10-11T12:10:00Z", clock)).toBe(
      "Ping received from acme at 12:10. PR checks are on.",
    );
    expect(pingText("acme", "nonsense", () => "")).toBe(
      "Ping received from acme. PR checks are on.",
    );
  });
});
