/**
 * The settings feature's Hub endpoints (`api.md` of the Hub repository is their wire contract), one
 * function for each route. What the Hub refuses in a way a person settles is a result, not an
 * error: a conflict, a path someone may not change, a configuration that does not check, a domain
 * another workspace holds.
 *
 * @module peerHub/plugins/settings/client/hub
 */
import * as C from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";

type Answer = Schema.Top & { readonly DecodingServices: never };

/** A body that is nothing: a `204`, or `{ "ok": true }`. */
const Nothing = Schema.NullOr(Schema.Struct({}));
const decodePreview = Schema.decodeUnknownOption(C.PeerSettingsPreview);
/** What a refusal's details hold: the paths refused, or the diagnostics. */
const decodeDetails = Schema.decodeUnknownOption(
  Schema.Struct({
    refused: Schema.optional(Schema.Array(C.PeerSettingsRefusal)),
    diagnostics: Schema.optional(Schema.Array(C.PeerSettingsDiagnostic)),
  }),
);
const decodeClaim = Schema.decodeUnknownOption(
  Schema.Struct({
    domain: Schema.String,
    record: Schema.String,
    holder: Schema.optional(
      Schema.Struct({ slug: Schema.String, name: Schema.String, verified: Schema.Boolean }),
    ),
    dns: Schema.optional(Schema.String),
  }),
);

/** The 403 of a path the caller does not own, and the 422 of a configuration that does not check. */
const rejection = (status: 403 | 422, code: string, details: unknown) => {
  const found = Option.getOrUndefined(decodeDetails(details));
  if (status === 403 && code === "settings_forbidden" && found?.refused !== undefined) {
    return { kind: "forbidden", refused: found.refused } as const;
  }
  return status === 422 && code === "invalid_settings" && found?.diagnostics !== undefined
    ? ({ kind: "invalid", diagnostics: found.diagnostics } as const)
    : undefined;
};

/** What a change sends besides what it names. */
const settle = (
  input: Pick<C.PeerSettingsChangeInput, "message" | "force" | "drop"> & {
    readonly dryRun: boolean;
  },
) => ({
  ...(input.message?.trim() ? { message: input.message.trim() } : {}),
  ...(input.dryRun === true ? { dryRun: true } : {}),
  ...(input.force?.length ? { force: input.force } : {}),
  ...(input.drop?.length ? { drop: input.drop } : {}),
});

const segment = encodeURIComponent;

export const settingsHub = (client: PeerHubClient.PeerHubClient["Service"]) => {
  const read = <S extends Answer>(schema: S, workspace: string, path: string) =>
    client.request(schema, { workspace, path });
  /** A call that changes something; the Hub may take long to answer one (a DNS lookup). */
  const send = <S extends Answer>(
    schema: S,
    workspace: string,
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body: object = {},
  ) =>
    client.request(schema, {
      workspace,
      path,
      method,
      timeoutMs: 30_000,
      ...(method === "DELETE" ? {} : { body }),
    });
  /** A change on `path`: a dry run is a `preview`, a save is `saved`, and the Hub's refusals are results. */
  const change = (workspace: string, path: string, body: object, saving: boolean) =>
    client
      .request<typeof C.PeerSettingsSaved, C.PeerSettingsChangeResult>(C.PeerSettingsSaved, {
        workspace,
        path,
        method: "POST",
        body,
        // A conflict names its fields; one that names none (the Hub lost its races to save) fails
        // with the Hub's words, to be tried again.
        conflict: (code, details) => {
          const preview = decodePreview(details);
          return code === "settings_conflict" &&
            Option.isSome(preview) &&
            preview.value.conflicts.length > 0
            ? { kind: "conflict", ...preview.value }
            : undefined;
        },
        rejected: rejection,
      })
      .pipe(
        Effect.map((answer): C.PeerSettingsChangeResult =>
          "kind" in answer ? answer : { kind: saving ? "saved" : "preview", ...answer },
        ),
      );
  const changes = (saving: boolean) => (input: C.PeerSettingsChangeInput) =>
    change(
      input.workspace,
      "/settings/changes",
      {
        base: input.base,
        set: input.set,
        ...settle({ ...input, dryRun: !saving }),
        ...(input.via === undefined ? {} : { via: input.via }),
      },
      saving,
    );

  return {
    view: (workspace: string) => read(C.PeerSettingsView, workspace, "/settings"),
    preview: changes(false),
    save: changes(true),
    secrets: ({ workspace }: C.PeerSettingsWorkspaceInput) =>
      read(C.PeerSettingsSecretsView, workspace, "/settings/secrets"),
    putSecret: (input: C.PeerSettingsPutSecretInput) =>
      send(Nothing, input.workspace, "PUT", `/secrets/${segment(input.name)}`, {
        value: input.value,
      }).pipe(Effect.as({})),
    deleteSecret: (input: C.PeerSettingsDeleteSecretInput) =>
      send(Nothing, input.workspace, "DELETE", `/secrets/${segment(input.name)}`).pipe(
        Effect.as({}),
      ),
    domainRecord: (input: C.PeerSettingsDomainInput) =>
      read(C.PeerDomainRecord, input.workspace, `/domains/${segment(input.domain)}/record`),
    verifyDomain: (input: C.PeerSettingsDomainInput) =>
      send(
        C.PeerSettingsDomainCheck,
        input.workspace,
        "POST",
        `/domains/${segment(input.domain)}/verify`,
      ),
    updateWorkspace: (input: C.PeerSettingsUpdateWorkspaceInput) =>
      client
        .request<typeof C.PeerSettingsWorkspace, C.PeerSettingsWorkspaceUpdate>(
          C.PeerSettingsWorkspace,
          {
            workspace: input.workspace,
            path: "",
            method: "PATCH",
            body: {
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(input.allowedDomains === undefined
                ? {}
                : { allowedDomains: input.allowedDomains }),
            },
            conflict: (code, details) => {
              const claim = decodeClaim(details);
              return code === "domain_claimed" && Option.isSome(claim)
                ? { kind: "domain-claimed", ...claim.value }
                : undefined;
            },
          },
        )
        .pipe(
          Effect.map((answer): C.PeerSettingsWorkspaceUpdate =>
            "kind" in answer ? answer : { kind: "updated", workspace: answer },
          ),
        ),
  };
};

export type SettingsHub = ReturnType<typeof settingsHub>;
