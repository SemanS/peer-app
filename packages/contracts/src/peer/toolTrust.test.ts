import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  PeerManifest,
  PeerToolTrustApproveInput,
  PeerToolTrustSetSecretInput,
  PeerToolTrustTurnOffInput,
} from "../index.ts";
describe("workspace tool trust contracts", () => {
  it("decodes old and new manifests", () => {
    const manifest = {
      version: 2,
      workspace: { slug: "acme", name: "Acme", currency: "EUR" },
      member: { email: "ana@example.test", name: "Ana", role: "member" },
      knowledge: {},
      projects: [],
    };
    expect(Schema.decodeUnknownSync(PeerManifest)(manifest).workspace.appliedBy).toBeUndefined();
    expect(
      Schema.decodeUnknownSync(PeerManifest)({
        ...manifest,
        workspace: {
          ...manifest.workspace,
          appliedBy: "ana@example.test",
          appliedAt: "2026-10-09T00:00:00Z",
        },
      }).workspace.appliedBy,
    ).toBe("ana@example.test");
  });
  it("rejects bad names and header injection values", () => {
    for (const name of ["lowercase", "../TOKEN", "A".repeat(65)])
      expect(() =>
        Schema.decodeUnknownSync(PeerToolTrustSetSecretInput)({
          workspace: "acme",
          name,
          source: { kind: "value", value: "safe" },
        }),
      ).toThrow();
    for (const value of ["", "x\r", "x\n", "x\0", "x".repeat(8193)])
      expect(() =>
        Schema.decodeUnknownSync(PeerToolTrustSetSecretInput)({
          workspace: "acme",
          name: "TOKEN",
          source: { kind: "value", value },
        }),
      ).toThrow();
  });
  it("bounds approval and turn-off batches", () => {
    for (const items of [
      [],
      Array.from({ length: 65 }, () => ({
        workspace: "acme",
        tool: "tracker",
        fingerprint: "sha256:x",
      })),
    ]) {
      expect(() => Schema.decodeUnknownSync(PeerToolTrustApproveInput)({ items })).toThrow();
      expect(() => Schema.decodeUnknownSync(PeerToolTrustTurnOffInput)({ items })).toThrow();
    }
  });
});
