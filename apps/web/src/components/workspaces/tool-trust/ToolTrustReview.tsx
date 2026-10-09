import {
  TOOL_TRUST_CODEX_NOTICE,
  TOOL_TRUST_OWNER_MESSAGE,
  TOOL_TRUST_STDIO_NOTICE,
  toolTrustReview,
  toolTrustStateLabel,
} from "@t3tools/client-runtime/peer-tool-trust";
import type { EnvironmentId, PeerHubStatus, PeerToolTrustSetSecretInput } from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../../ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { failureMessage } from "../WorkspaceAccess";
import { useToolTrustControls } from "./useToolTrustControls";

function SecretControl({
  name,
  source,
  environmentSet,
  disabled,
  onSet,
}: {
  name: string;
  source: string;
  environmentSet: boolean;
  disabled: boolean;
  onSet: (source: PeerToolTrustSetSecretInput["source"]) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {name} · {source} · environment {environmentSet ? "set" : "not set"}
      </p>
      <Input
        aria-label={`Secret ${name}`}
        type="password"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled || value.length === 0}
          onClick={() => {
            const entered = value;
            setValue("");
            void onSet({ kind: "value", value: entered });
          }}
        >
          Store value
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void onSet({ kind: "environment" })}
        >
          Use environment variable
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => void onSet({ kind: "none" })}
        >
          Forget
        </Button>
      </div>
    </div>
  );
}
/** The exact templates being approved, with secrets named and remote header values hidden. */
export function ToolTrustReview({
  environmentId,
  status,
  workspace,
  open,
  onOpenChange,
}: {
  environmentId: EnvironmentId;
  status: PeerHubStatus;
  workspace?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const controls = useToolTrustControls(environmentId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = toolTrustReview(status).filter(
    (group) => workspace === undefined || group.workspace === workspace,
  );
  const rows = groups.flatMap((group) => group.tools);
  const approvals = rows.flatMap((row) =>
    row.fingerprint === undefined || row.state === "invalid" || row.state === "on"
      ? []
      : [{ workspace: row.workspace, tool: row.tool, fingerprint: row.fingerprint }],
  );
  const offItems = [
    ...new Map(
      rows.map((row) => [
        `${row.workspace}/${row.tool}`,
        { workspace: row.workspace, tool: row.tool },
      ]),
    ).values(),
  ];
  const run = async (action: () => Promise<string | null>) => {
    setPending(true);
    setError(null);
    try {
      setError(await action());
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Review workspace tools</DialogTitle>
          <DialogDescription>
            Choose what runs on this computer and which secret sources it may use.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">{TOOL_TRUST_CODEX_NOTICE}</p>
          {controls.approve ? null : <p>{TOOL_TRUST_OWNER_MESSAGE}</p>}
          {status.toolTrust?.error === undefined ? null : (
            <p role="alert">{status.toolTrust.error}</p>
          )}
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                pending || !controls.approve || approvals.length === 0 || approvals.length > 64
              }
              onClick={() =>
                void run(async () =>
                  failureMessage(
                    await controls.approveTools({ environmentId, input: { items: approvals } }),
                  ),
                )
              }
            >
              Approve all
            </Button>
            <Button
              variant="outline"
              disabled={
                pending || !controls.turnOff || offItems.length === 0 || offItems.length > 64
              }
              onClick={() =>
                void run(async () =>
                  failureMessage(
                    await controls.turnOffTools({ environmentId, input: { items: offItems } }),
                  ),
                )
              }
            >
              Keep all off
            </Button>
          </div>
          {approvals.length > 64 || offItems.length > 64 ? (
            <p>Review up to 64 definitions at a time using the individual controls.</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.workspace} className="space-y-4">
              <h3 className="font-medium">
                {group.name} · {group.workspace}
              </h3>
              {group.appliedBy === undefined ? null : (
                <p className="text-sm text-muted-foreground">
                  Applied by {group.appliedBy}
                  {group.appliedAt === undefined ? "" : ` · ${group.appliedAt}`}
                </p>
              )}
              {group.tools.map((row) => (
                <article key={row.key} className="space-y-2 rounded-lg border p-3">
                  <h4 className="font-medium">
                    {row.name} · {toolTrustStateLabel[row.state]}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {row.projects.join(", ")} · {row.providers.join(", ")}
                  </p>
                  {row.review.transport === "stdio" ? (
                    <>
                      <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
                        {row.review.command}
                        {"\n"}
                        {row.review.args.join("\n")}
                        {"\n"}
                        {row.review.env.map(([name, value]) => `${name}=${value}`).join("\n")}
                      </pre>
                      <p className="text-sm text-muted-foreground">{TOOL_TRUST_STDIO_NOTICE}</p>
                    </>
                  ) : (
                    <>
                      <p className="break-all text-sm">{row.review.url}</p>
                      {row.review.headers.map((header) => (
                        <p key={header.name} className="text-sm">
                          Header {header.name}
                          {header.secrets.length === 0
                            ? ""
                            : ` · secrets ${header.secrets.join(", ")}`}
                        </p>
                      ))}
                    </>
                  )}
                  {row.changes.length === 0 ? null : <p>Changed: {row.changes.join(", ")}</p>}
                  {row.missing.length === 0 ? null : <p>Needs secrets: {row.missing.join(", ")}</p>}
                  {row.reason === undefined ? null : <p>{row.reason}</p>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={
                        pending ||
                        !controls.approve ||
                        row.fingerprint === undefined ||
                        row.state === "invalid" ||
                        row.state === "on"
                      }
                      onClick={() => {
                        if (row.fingerprint !== undefined)
                          void run(async () =>
                            failureMessage(
                              await controls.approveTools({
                                environmentId,
                                input: {
                                  items: [
                                    {
                                      workspace: row.workspace,
                                      tool: row.tool,
                                      fingerprint: row.fingerprint!,
                                    },
                                  ],
                                },
                              }),
                            ),
                          );
                      }}
                    >
                      {row.state === "off" ? "Turn on" : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || !controls.turnOff || row.state === "off"}
                      onClick={() =>
                        void run(async () =>
                          failureMessage(
                            await controls.turnOffTools({
                              environmentId,
                              input: { items: [{ workspace: row.workspace, tool: row.tool }] },
                            }),
                          ),
                        )
                      }
                    >
                      Turn off
                    </Button>
                  </div>
                </article>
              ))}
              {group.secrets.map((secret) => (
                <SecretControl
                  key={secret.name}
                  {...secret}
                  disabled={pending || !controls.approve}
                  onSet={async (source) => {
                    await run(async () =>
                      failureMessage(
                        await controls.setSecret({
                          environmentId,
                          input: { workspace: group.workspace, name: secret.name, source },
                        }),
                      ),
                    );
                  }}
                />
              ))}
            </section>
          ))}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
