import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../settings/settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    status,
  }: {
    title: ReactNode;
    description: ReactNode;
    status?: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      {status}
    </section>
  ),
}));

import { OwnersSettings } from "./OwnersSettings";
import { BOB, EVA, ENV, statusFor, type Looking } from "./ownership.testkit";

let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function show(email: string, looking: Looking = {}) {
  const status = statusFor(email, looking);
  const workspace = status.workspaces[0]!;
  await act(async () => {
    renderer = create(
      <OwnersSettings
        environmentId={ENV}
        status={status}
        workspace={workspace}
        state={workspace.projects[0]!}
      />,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("the Owners row on a project's Basics page", () => {
  it("says who sets owners and what renaming an area does, and counts what has an owner", async () => {
    await show(EVA);
    expect(words(renderer!.root.findByType("h3"))).toBe("Owners");
    const said = words(renderer!.root);
    expect(said).toContain(
      "Leads and admins set who owns tasks and areas on the Team page. Renaming an area leaves its owner behind until a lead sets it again.",
    );
    expect(said).toContain("1 area with an owner · 1 task without one");
  });

  it("reads the same for a member, who cannot change it", async () => {
    await show(BOB);
    expect(words(renderer!.root)).toContain("1 area with an owner · 1 task without one");
  });

  it("counts nothing where ownership is not known for the project, and keeps what it says", async () => {
    await show(EVA, { ownership: null });
    expect(words(renderer!.root.findByType("h3"))).toBe("Owners");
    expect(words(renderer!.root)).not.toContain("with an owner");
  });
});
