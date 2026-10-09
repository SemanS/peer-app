import { describe, expect, it } from "@effect/vitest";
import {
  heldResources,
  mayRelease,
  needsReleaseConfirmation,
  releaseInput,
  resourceTimeLeft,
} from "./resources.ts";
import type { PeerHubStatus } from "@t3tools/contracts";
const h = {
  workspace: "acme",
  project: "app",
  kind: "resource" as const,
  name: "deploy",
  holder: { session: "a", email: "ana", environment: "laptop" },
  expiresAt: "2026-10-09T12:30:00Z",
  at: "2026-10-09T12:00:00Z",
};
const status = {
  email: "ana",
  workspaces: [
    { slug: "acme", role: "member", projects: [{ project: { id: "app", role: "member" } }] },
  ],
  resources: { held: [h, { ...h, kind: "pattern", name: "migrations/**" }] },
} as unknown as PeerHubStatus;
describe("held scopes on every client", () => {
  it("uses Hub time despite a device skew, retains expiry pending server refresh, and orders scopes", () => {
    const local = Date.parse("2026-10-09T08:00:00Z");
    expect(resourceTimeLeft(h, local, local + 60_000)).toBe("29 min left");
    expect(resourceTimeLeft(h, local, local + 31 * 60_000)).toBe("Checking expiry…");
    expect(heldResources(status).map((r) => r.name)).toEqual(["migrations/**", "deploy"]);
    expect(heldResources({ ...status, resources: { held: [h] } })).toHaveLength(1);
  });
  it("allows own person, project leads and workspace admins, and confirms another person's release", () => {
    expect(mayRelease(status, h)).toBe(true);
    const other = { ...h, holder: { ...h.holder, email: "vir" } };
    expect(mayRelease(status, other)).toBe(false);
    expect(
      mayRelease({ ...status, workspaces: [{ ...status.workspaces[0]!, role: "admin" }] }, other),
    ).toBe(true);
    expect(
      mayRelease(
        {
          ...status,
          workspaces: [
            {
              ...status.workspaces[0]!,
              projects: [
                {
                  ...status.workspaces[0]!.projects[0]!,
                  project: { ...status.workspaces[0]!.projects[0]!.project, role: "lead" },
                },
              ],
            },
          ],
        },
        other,
      ),
    ).toBe(true);
    expect(needsReleaseConfirmation(status, h)).toBe(false);
    expect(needsReleaseConfirmation(status, other)).toBe(true);
    expect(releaseInput(h)).toEqual({
      workspace: "acme",
      project: "app",
      target: "resource:deploy",
    });
    expect(releaseInput({ ...h, kind: "pattern", name: "migrations/**" }).target).toBe(
      "migrations/**",
    );
  });
});
