import * as Schema from "effect/Schema";

export const PEER_ANNOUNCEMENTS_PLUGIN = {
  id: "announcements",
  title: "Announcements",
  summary: "Hear project announcements once and report delivery.",
  defaultEnabled: true,
  commandNames: ["announcements"],
} as const;
export const PeerAnnouncementText = Schema.String.check(
  Schema.makeFilter(
    (text) =>
      ([...text].length >= 1 && [...text].length <= 300) ||
      "Announcement text must be 1–300 characters.",
  ),
);
export const PeerAnnouncementAuthor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person"), email: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("credential"), id: Schema.String, label: Schema.String }),
]);
export type PeerAnnouncementAuthor = typeof PeerAnnouncementAuthor.Type;
export const PeerAnnouncement = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  author: PeerAnnouncementAuthor,
  text: PeerAnnouncementText,
  task: Schema.optional(Schema.String),
  topic: Schema.optional(Schema.String),
  wake: Schema.Boolean,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  withdrawnAt: Schema.optional(Schema.String),
  withdrawnBy: Schema.optional(PeerAnnouncementAuthor),
  status: Schema.optional(Schema.Literals(["active", "withdrawn", "expired"])),
});
export type PeerAnnouncement = typeof PeerAnnouncement.Type;
export const PeerAnnouncementCounts = Schema.Struct({
  waiting: Schema.Number,
  "not-following": Schema.Number,
  offered: Schema.Number,
  "model-input": Schema.Number,
  acknowledged: Schema.Number,
});
export type PeerAnnouncementCounts = typeof PeerAnnouncementCounts.Type;
export const PeerAnnouncementAudience = Schema.Struct({
  session: Schema.String,
  email: Schema.String,
  environment: Schema.String,
  state: Schema.Literals(["waiting", "not-following", "offered", "model-input", "acknowledged"]),
  live: Schema.Boolean,
  agent: Schema.optional(Schema.String),
  task: Schema.optional(Schema.String),
  offeredAt: Schema.optional(Schema.String),
  modelInputAt: Schema.optional(Schema.String),
  acknowledgedAt: Schema.optional(Schema.String),
});
export type PeerAnnouncementAudience = typeof PeerAnnouncementAudience.Type;
export const PeerAnnouncementWithCounts = PeerAnnouncement.mapFields((fields) => ({
  ...fields,
  counts: PeerAnnouncementCounts,
}));
export const PeerAnnouncementDetail = PeerAnnouncementWithCounts.mapFields((fields) => ({
  ...fields,
  audience: Schema.Array(PeerAnnouncementAudience),
}));
export type PeerAnnouncementDetail = typeof PeerAnnouncementDetail.Type;
export const PeerAnnouncementList = Schema.Struct({
  at: Schema.String,
  announcements: Schema.Array(PeerAnnouncementWithCounts),
});
export type PeerAnnouncementList = typeof PeerAnnouncementList.Type;
export const PeerAnnouncementReceipt = Schema.Struct({
  project: Schema.String,
  announcement: Schema.String,
  session: Schema.String,
  state: Schema.Literals(["offered", "modelInput", "acknowledged"]),
  at: Schema.optional(Schema.String),
});
export type PeerAnnouncementReceipt = typeof PeerAnnouncementReceipt.Type;
export const PeerAnnouncementSync = Schema.Struct({
  at: Schema.String,
  announcements: Schema.Array(PeerAnnouncement),
  delivered: Schema.Array(
    PeerAnnouncementReceipt.mapFields((fields) => ({ ...fields, offeredAt: Schema.String })),
  ),
  rejected: Schema.Array(
    Schema.Struct({
      announcement: Schema.optional(Schema.NullOr(Schema.String)),
      session: Schema.optional(Schema.NullOr(Schema.String)),
      reason: Schema.String,
    }),
  ),
});
export type PeerAnnouncementSync = typeof PeerAnnouncementSync.Type;
export const PeerAnnouncementsStatus = Schema.Struct({
  unsupported: Schema.Array(Schema.String),
  projects: Schema.Array(
    Schema.Struct({
      workspace: Schema.String,
      project: Schema.String,
      active: Schema.Number,
      rev: Schema.String,
    }),
  ),
  wake: Schema.Boolean,
});
export type PeerAnnouncementsStatus = typeof PeerAnnouncementsStatus.Type;
export const PeerAnnouncementProjectInput = Schema.Struct({
  workspace: Schema.String,
  project: Schema.String,
});
export type PeerAnnouncementProjectInput = typeof PeerAnnouncementProjectInput.Type;
export const PeerAnnouncementInput = PeerAnnouncementProjectInput.mapFields((fields) => ({
  ...fields,
  id: Schema.String,
}));
export type PeerAnnouncementInput = typeof PeerAnnouncementInput.Type;
export const PeerAnnouncementPostInput = PeerAnnouncementProjectInput.mapFields((fields) => ({
  ...fields,
  text: PeerAnnouncementText,
  task: Schema.optional(Schema.String),
  topic: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-z0-9._-]{1,40}$/))),
  validForMinutes: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(5), Schema.isLessThanOrEqualTo(10080)),
  ),
  wake: Schema.Boolean,
  op: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
}));
export type PeerAnnouncementPostInput = typeof PeerAnnouncementPostInput.Type;
export const PeerAnnouncementPostResult = PeerAnnouncement.mapFields((fields) => ({
  ...fields,
  replaced: Schema.optional(Schema.Array(Schema.String)),
}));
export const PeerAnnouncementWithdrawInput = PeerAnnouncementProjectInput.mapFields((fields) => ({
  ...fields,
  id: Schema.optional(Schema.String),
  topic: Schema.optional(Schema.String),
}));
export type PeerAnnouncementWithdrawInput = typeof PeerAnnouncementWithdrawInput.Type;
export const PeerAnnouncementWithdrawResult = Schema.Struct({
  withdrawn: Schema.Array(Schema.String),
});
export const PeerAnnouncementCredential = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.optional(Schema.String),
  revokedBy: Schema.optional(Schema.String),
  lastUsedAt: Schema.optional(Schema.String),
  uses: Schema.Number,
  status: Schema.Literals(["active", "revoked", "expired"]),
});
export type PeerAnnouncementCredential = typeof PeerAnnouncementCredential.Type;
export const PeerAnnouncementCredentials = Schema.Struct({
  credentials: Schema.Array(PeerAnnouncementCredential),
});
export type PeerAnnouncementCredentials = typeof PeerAnnouncementCredentials.Type;
export const PeerAnnouncementCredentialCreated = PeerAnnouncementCredential.mapFields((fields) => ({
  ...fields,
  secret: Schema.String,
}));
export type PeerAnnouncementCredentialCreated = typeof PeerAnnouncementCredentialCreated.Type;
export const PeerAnnouncementCredentialCreateInput = PeerAnnouncementProjectInput.mapFields(
  (fields) => ({
    ...fields,
    label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
    validForDays: Schema.optional(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(365)),
    ),
  }),
);
export type PeerAnnouncementCredentialCreateInput =
  typeof PeerAnnouncementCredentialCreateInput.Type;
export const PeerAnnouncementsSetWakeInput = Schema.Struct({ wake: Schema.Boolean });
