import { buildWorkTree } from "@t3tools/client-runtime/peer/work";
import {
  EnvironmentId,
  PEER_PLUGIN_IDS,
  type PeerHubStatus,
  type PeerPluginState,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// The slot users' screens are React Native components; their signals are plain functions.
vi.mock("../announcements/PeerAnnouncements", () => ({ PeerAnnouncements: () => null }));
vi.mock("../announcements/AnnouncementPreferences", () => ({
  AnnouncementPreferences: () => null,
}));
vi.mock("../resources/PeerHeldResources", () => ({ PeerHeldResources: () => null }));
vi.mock("../memory/MemorySettingsRow", () => ({ MemorySettingsRow: () => null }));

import { announcementsMobilePlugin } from "../announcements";
import { knowledgeMobilePlugin } from "../knowledge";
import { memoryMobilePlugin } from "../memory";
import { resourcesMobilePlugin } from "../resources";
import { selectPeerPlugins } from "../slots.logic";
import { projectSignals } from "./signals";

/** The plugins that fill `projectSignals`, as `PEER_MOBILE_PLUGINS` lists them. */
const SLOT_USERS = [
  knowledgeMobilePlugin,
  memoryMobilePlugin,
  announcementsMobilePlugin,
  resourcesMobilePlugin,
];

const project = (id: string, name: string) => ({
  project: { id, name, role: "member", members: [] },
  repositories: [],
  work: { areas: [], tasks: [], threads: [] },
});

function status(overrides: Partial<Record<keyof PeerHubStatus, unknown>> = {}): PeerHubStatus {
  return {
    signedIn: true,
    email: "ana@acme.test",
    environmentId: EnvironmentId.make("laptop"),
    error: null,
    sharedThreads: [],
    agents: { herdr: "running", list: [] },
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        projects: [project("kirkwood", "Kirkwood"), project("payments", "Payments")],
      },
    ],
    coordination: {
      enabled: true,
      sessions: [],
      overlaps: [
        {
          id: "o1",
          workspace: "acme",
          project: "kirkwood",
          sessions: ["s1", "s2"],
          state: "open",
          updatedAt: "2026-10-10T11:00:00Z",
          files: ["src/pay.ts"],
          notes: [],
          policy: "ask",
        },
      ],
      findings: [],
      contexts: [],
      candidates: [{ workspace: "acme", project: "kirkwood", proposed: 3 }],
    },
    announcements: {
      unsupported: [],
      projects: [{ workspace: "acme", project: "kirkwood", active: 2, rev: "r1" }],
    },
    resources: {
      held: [
        {
          workspace: "acme",
          project: "kirkwood",
          kind: "resource",
          name: "staging-db",
          holder: { email: "ben@acme.test", session: "s2", environment: "ben-laptop" },
          expiresAt: "2026-10-10T13:00:00Z",
          at: "2026-10-10T11:30:00Z",
        },
      ],
    },
    ...overrides,
  } as unknown as PeerHubStatus;
}

const projectNode = (from: PeerHubStatus, id: string) =>
  buildWorkTree({ status: from, localThreads: [], now: Date.parse("2026-10-10T12:00:00Z") }).find(
    (node) => node.projectId === id,
  )!;

describe("the projectSignals slot", () => {
  it("is filled by knowledge, memory, announcements and resources, in registry order", () => {
    expect(SLOT_USERS.every((plugin) => plugin.projectSignals !== undefined)).toBe(true);
    const ids = SLOT_USERS.map((plugin) => plugin.id);
    expect(ids).toEqual(PEER_PLUGIN_IDS.filter((id) => ids.includes(id)));
  });

  it("puts core's overlaps first, then each plugin's signal in its color", () => {
    const signals = projectSignals(status(), projectNode(status(), "kirkwood"), SLOT_USERS);
    expect(signals.map((signal) => [signal.label, signal.count, signal.tone])).toEqual([
      ["Overlaps", 1, "coordination"],
      ["Knowledge to keep", 3, "knowledge"],
      ["Memory", null, "knowledge"],
      ["Announcements", 2, "team"],
      ["Held resources", 1, "coordination"],
    ]);
    expect(signals.map((signal) => signal.detail)).toEqual([
      "src/pay.ts",
      "3 findings to keep or dismiss",
      "Findings, evidence, questions",
      "Every live agent gets them once",
      "Resource staging-db",
    ]);
  });

  it("counts only the project's own and says why there is nothing", () => {
    const signals = projectSignals(status(), projectNode(status(), "payments"), SLOT_USERS);
    expect(signals.map((signal) => [signal.label, signal.count, signal.detail])).toEqual([
      ["Overlaps", 0, "No agents on the same file"],
      ["Knowledge to keep", 0, "Nothing proposed"],
      ["Memory", null, "Findings, evidence, questions"],
      ["Announcements", 0, "None active"],
      ["Held resources", 0, "None held"],
    ]);
  });

  it("leaves out overlaps while coordination is off, and what inactive plugins would add", () => {
    const plugin = (id: string, active: boolean): PeerPluginState => ({
      id,
      title: id,
      enabled: active,
      active,
    });
    const off = status({
      coordination: { ...status().coordination, enabled: false },
      plugins: [
        plugin("knowledge", false),
        plugin("announcements", true),
        plugin("resources", true),
      ],
    });
    expect(
      projectSignals(off, projectNode(off, "kirkwood"), selectPeerPlugins(SLOT_USERS, off)).map(
        (signal) => signal.id,
      ),
    ).toEqual(["announcements", "resources"]);
  });
});
