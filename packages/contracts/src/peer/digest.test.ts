import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { PeerCoordEvent } from "../peerHub.ts";
import { PeerDigest, digestPhrase } from "./digest.ts";
const decodeDigest = Schema.decodeUnknownSync(PeerDigest),
  decodeEvent = Schema.decodeUnknownSync(PeerCoordEvent);
export const digestSample = {
  project: "app",
  since: "2026-10-09T00:00:00Z",
  until: "2026-10-09T08:00:00Z",
  coverage: { complete: true },
  sections: [
    {
      id: "tasks",
      title: "Tasks",
      total: 1,
      entries: [
        {
          kind: "task.closed",
          at: "2026-10-09T07:00:00Z",
          by: ["ana"],
          subject: "Task",
          detail: "open → done",
          ref: { type: "task", id: "t" },
        },
      ],
    },
  ],
};
it("decodes complete, extensible sections and entry kinds, stripping extra fields", () => {
  expect(decodeDigest(digestSample)).toEqual(digestSample);
  const newer = {
    ...digestSample,
    extra: "ignored",
    sections: [
      {
        ...digestSample.sections[0]!,
        id: "future",
        entries: [
          { ...digestSample.sections[0]!.entries[0]!, kind: "future.solved", extra: "ignored" },
        ],
      },
    ],
  };
  expect(decodeDigest(newer).sections[0]!.entries[0]!.kind).toBe("future.solved");
  expect(digestPhrase("announcement.posted")).toBe("posted by");
  expect(digestPhrase("future.solved")).toBe("solved");
});
it("keeps optional coordination facts compatible with older events", () => {
  const old = {
    id: "e",
    kind: "task-status",
    project: "app",
    at: "time",
    paths: [],
    participants: [],
  };
  expect(decodeEvent(old)).toEqual(old);
  expect(
    decodeEvent({
      ...old,
      status: "done",
      fromStatus: "open",
      link: "https://github.com/o/r/pull/1",
    }),
  ).toMatchObject({ status: "done", fromStatus: "open" });
});
