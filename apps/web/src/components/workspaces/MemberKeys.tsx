import type { EnvironmentId, PeerMemberKeys } from "@t3tools/contracts";
import { useState } from "react";
import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { FoldedSettingsRow, NestedRowTitle, SettingsRowError } from "./PeerSettingsRows";
import { failureMessage } from "./WorkspaceAccess";
import { withFinally } from "~/lib/withFinally";

/**
 * Members can inspect and revoke their own keys, including keys issued to another environment.
 * `asRow` shows them as the person's own settings row; otherwise they fold under a member.
 */
export function MemberKeys({
  environmentId,
  workspace,
  email,
  asRow = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly email: string;
  readonly asRow?: boolean;
}) {
  const loadKeys = useAtomCommand(serverEnvironment.peerHubMemberKeys, { reportFailure: false });
  const revoke = useAtomCommand(serverEnvironment.peerHubRevokeMemberKeys, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PeerMemberKeys | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setError(null);
    setData(null);
    await withFinally(
      async () => {
        const result = await loadKeys({ environmentId, input: { workspace, email } });
        if (result._tag === "Success") setData(result.value);
        else setError(failureMessage(result));
      },
      () => {
        setBusy(false);
      },
    );
  };
  const toggle = () => {
    setOpen(!open);
    if (!open) void load();
  };
  const keys = !open ? null : (
    <div className="flex flex-col gap-2">
      <Button
        className="self-start"
        variant="outline"
        size="xs"
        disabled={busy}
        onClick={() => void load()}
      >
        {busy ? "Loading…" : "Refresh keys"}
      </Button>
      {error ? <SettingsRowError>{error}</SettingsRowError> : null}
      {data?.keys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No live keys.</p>
      ) : null}
      {data?.keys.map((key) => (
        <div
          key={`${key.project}/${key.environment}/${key.keyRef}`}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs text-muted-foreground">
            {key.project} · {key.environment} · {key.keyRef} ·{" "}
            {key.expiresAt ? `expires ${key.expiresAt}` : "no expiry (legacy key)"}
          </span>
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => {
              void (async () => {
                if (
                  !(await ensureLocalApi().dialogs.confirm(
                    `Revoke shared-capacity keys for ${email} in ${key.project} on ${key.environment}? Running shared-capacity sessions using these keys will stop working.`,
                  ))
                )
                  return;
                setBusy(true);
                setError(null);
                await withFinally(
                  async () => {
                    try {
                      const result = await revoke({
                        environmentId,
                        input: {
                          workspace,
                          email,
                          project: key.project,
                          environment: key.environment,
                        },
                      });
                      const failure = failureMessage(result);
                      if (failure) setError(failure);
                      else await load();
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    }
                  },
                  () => {
                    setBusy(false);
                  },
                );
              })();
            }}
          >
            Revoke keys
          </Button>
        </div>
      ))}
      {data?.pending.map((key) => (
        <p key={key.keyRef} className="text-xs text-muted-foreground">
          {key.project} · {key.environment} · {key.keyRef}: queued {key.queuedAt}, {key.attempts}{" "}
          attempts{key.lastError ? ` (${key.lastError})` : ""}
        </p>
      ))}
    </div>
  );
  if (asRow)
    return (
      <FoldedSettingsRow
        title={<NestedRowTitle under="workspace">Your shared-capacity keys</NestedRowTitle>}
        label="your shared-capacity keys"
        description={`Keys issued to ${email} for the workspace’s shared capacity, on each of your computers.`}
        open={open}
        busy={busy}
        onOpenChange={toggle}
      >
        {keys}
      </FoldedSettingsRow>
    );
  return (
    <div className="flex flex-col gap-2">
      <Button
        className="self-start"
        variant="ghost"
        size="xs"
        disabled={busy}
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? "Hide shared-capacity keys" : "Shared-capacity keys"}
      </Button>
      {keys === null ? null : <div className="pl-3">{keys}</div>}
    </div>
  );
}
