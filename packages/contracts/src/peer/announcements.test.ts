import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  PeerAnnouncement,
  PeerAnnouncementPostInput,
  PeerAnnouncementSync,
  PeerAnnouncementDetail,
  PeerAnnouncementCredentialCreated,
} from "./announcements.ts";

const decodePeerAnnouncement = Schema.decodeUnknownSync(PeerAnnouncement);
const decodePeerAnnouncementDetail = Schema.decodeUnknownSync(PeerAnnouncementDetail);
const decodePeerAnnouncementSync = Schema.decodeUnknownSync(PeerAnnouncementSync);
const decodePeerAnnouncementCredentialCreated = Schema.decodeUnknownSync(
  PeerAnnouncementCredentialCreated,
);
const decodePeerAnnouncementPostInput = Schema.decodeUnknownSync(PeerAnnouncementPostInput);
const row = {
  id: "a1b2",
  project: "app",
  author: { kind: "person", email: "ana@example.test" },
  text: "CI is red",
  wake: true,
  createdAt: "2026-10-09T08:00:00Z",
  expiresAt: "2026-10-10T08:00:00Z",
  status: "active",
};
describe("announcement wire contracts", () => {
  it("reads Hub rows, audience and sync without retaining future fields", () => {
    expect(decodePeerAnnouncement({ ...row, future: "ignored" })).toEqual(row);
    const counts = {
      waiting: 1,
      "not-following": 0,
      offered: 0,
      "model-input": 0,
      acknowledged: 0,
    };
    expect(
      decodePeerAnnouncementDetail({
        ...row,
        counts,
        audience: [
          {
            session: "claude:x",
            email: "ana@example.test",
            environment: "desktop",
            state: "waiting",
            live: true,
          },
        ],
      }).audience[0]?.live,
    ).toBe(true);
    expect(
      decodePeerAnnouncementSync({
        at: row.createdAt,
        announcements: [row],
        delivered: [
          {
            project: "app",
            announcement: row.id,
            session: "claude:x",
            state: "modelInput",
            offeredAt: row.createdAt,
          },
        ],
        rejected: [{ reason: "session_not_owned", announcement: null, session: null }],
      }).delivered[0]?.state,
    ).toBe("modelInput");
  });
  it("counts Unicode scalar values rather than UTF-16 code units", () => {
    const decode = decodePeerAnnouncementPostInput;
    expect(
      decode({ workspace: "acme", project: "app", text: "😀".repeat(300), wake: true }).text,
    ).toHaveLength(600);
    for (const text of ["", "x".repeat(301), "😀".repeat(301)])
      expect(() => decode({ workspace: "acme", project: "app", text, wake: false })).toThrow();
    for (const topic of ["bad topic", "UPPER", "a".repeat(41)])
      expect(() =>
        decode({ workspace: "acme", project: "app", text: "ok", topic, wake: false }),
      ).toThrow();
    for (const validForMinutes of [4, 10081])
      expect(() =>
        decode({ workspace: "acme", project: "app", text: "ok", validForMinutes, wake: false }),
      ).toThrow();
  });
  it("returns the automation secret only from create", () => {
    const credential = {
      id: "abc",
      label: "CI",
      createdBy: "ana@example.test",
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      uses: 0,
      status: "active",
      secret: "pan_once",
    };
    expect(decodePeerAnnouncementCredentialCreated(credential).secret).toBe("pan_once");
  });
});
