import {
  TOOL_TRUST_CODEX_NOTICE,
  TOOL_TRUST_OWNER_MESSAGE,
  TOOL_TRUST_STDIO_NOTICE,
  toolTrustReview,
} from "@t3tools/client-runtime/peer-tool-trust";
import type { EnvironmentId, PeerHubStatus, PeerToolTrustSetSecretInput } from "@t3tools/contracts";
import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { ConnectionBadge } from "../../settings/ConnectionStatus";
import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Input } from "../../ui/input";
import {
  PeerCallout,
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
} from "../PeerDialog";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { PeerSectionLabel } from "../PeerPageHeader";
import { failureMessage } from "../WorkspaceAccess";
import { appliedByLine, toolStateBadge } from "./toolTrust.logic";
import { useToolTrustControls } from "./useToolTrustControls";

/** Who applied the workspace's file, or that nobody did and Peer manages its tools. */
function AppliedBy({ group }: { group: Parameters<typeof appliedByLine>[0] }) {
  const line = appliedByLine(group, formatRelativeTimeLabel);
  return line === null ? null : <p className="text-xs text-muted-foreground">{line}</p>;
}

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
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
      <p className="text-sm text-foreground">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">
          {" "}
          · {source} · environment {environmentSet ? "set" : "not set"}
        </span>
      </p>
      <Input
        aria-label={`Secret ${name}`}
        type="password"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="xs"
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
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => void onSet({ kind: "environment" })}
        >
          Use environment variable
        </Button>
        <Button
          size="xs"
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
  const approveAll = () =>
    void run(async () =>
      failureMessage(await controls.approveTools({ environmentId, input: { items: approvals } })),
    );
  const keepAllOff = () =>
    void run(async () =>
      failureMessage(await controls.turnOffTools({ environmentId, input: { items: offItems } })),
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <PeerDialogHeader
          icon={ShieldCheckIcon}
          tone="needs"
          title="Review workspace tools"
          context="Choose what runs on this computer and which secret sources it may use."
        />
        <PeerDialogBody>
          <p className="text-sm text-muted-foreground">{TOOL_TRUST_CODEX_NOTICE}</p>
          {controls.approve ? null : (
            <PeerCallout tone="neutral">{TOOL_TRUST_OWNER_MESSAGE}</PeerCallout>
          )}
          {status.toolTrust?.error === undefined ? null : (
            <PeerDialogMessage tone="error">{status.toolTrust.error}</PeerDialogMessage>
          )}
          {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          {approvals.length > 64 || offItems.length > 64 ? (
            <PeerDialogMessage>
              Review up to 64 definitions at a time using the individual controls.
            </PeerDialogMessage>
          ) : null}
          {groups.map((group) => (
            <section
              key={group.workspace}
              aria-label={group.name}
              className="flex flex-col gap-2.5"
            >
              <PeerSectionLabel>{group.name}</PeerSectionLabel>
              <AppliedBy group={group} />
              {group.tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">The workspace shares no tools.</p>
              ) : null}
              {group.tools.map((row) => (
                <article
                  key={row.key}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <h4 className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      {row.name}
                    </h4>
                    <ConnectionBadge {...toolStateBadge(row.state)} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.projects.join(", ")} · {row.providers.join(", ")}
                  </p>
                  {row.review.transport === "stdio" ? (
                    <>
                      <pre className="overflow-x-auto rounded-lg border border-border bg-background p-2.5 font-mono text-xs whitespace-pre-wrap text-foreground">
                        {row.review.command}
                        {"\n"}
                        {row.review.args.join("\n")}
                        {"\n"}
                        {row.review.env.map(([name, value]) => `${name}=${value}`).join("\n")}
                      </pre>
                      <p className="text-xs text-muted-foreground">{TOOL_TRUST_STDIO_NOTICE}</p>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1 text-xs">
                      <p className="font-mono break-all text-foreground">{row.review.url}</p>
                      {row.review.headers.map((header) => (
                        <p key={header.name} className="text-muted-foreground">
                          Header {header.name}
                          {header.secrets.length === 0
                            ? ""
                            : ` · secrets ${header.secrets.join(", ")}`}
                        </p>
                      ))}
                    </div>
                  )}
                  {row.changes.length === 0 ? null : (
                    <p className="text-xs text-warning-foreground">
                      Changed: {row.changes.join(", ")}
                    </p>
                  )}
                  {row.missing.length === 0 ? null : (
                    <p className="text-xs text-warning-foreground">
                      Needs secrets: {row.missing.join(", ")}
                    </p>
                  )}
                  {row.reason === undefined ? null : (
                    <p className="text-xs text-muted-foreground">{row.reason}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="xs"
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
                      size="xs"
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
        </PeerDialogBody>
        <PeerDialogFooter
          secondary={
            <Button
              variant="ghost"
              disabled={
                pending || !controls.turnOff || offItems.length === 0 || offItems.length > 64
              }
              onClick={keepAllOff}
            >
              Keep all off
            </Button>
          }
        >
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          <Button
            disabled={
              pending || !controls.approve || approvals.length === 0 || approvals.length > 64
            }
            onClick={approveAll}
          >
            Approve all
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
