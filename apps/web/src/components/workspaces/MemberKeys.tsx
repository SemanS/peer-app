import type { EnvironmentId, PeerMemberKeys } from "@t3tools/contracts";
import { useState } from "react";
import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { failureMessage } from "./WorkspaceAccess";

/** Members can inspect and revoke their own keys, including keys issued to another environment. */
export function MemberKeys({
  environmentId,
  workspace,
  email,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly email: string;
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
    try {
      const result = await loadKeys({ environmentId, input: { workspace, email } });
      if (result._tag === "Success") setData(result.value);
      else setError(failureMessage(result));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
      >
        Shared-capacity keys · {email}
      </Button>
      {!open ? null : (
        <div className="space-y-2 pl-4">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
            {busy ? "Loading…" : "Refresh keys"}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {data?.keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No live keys.</p>
          ) : null}
          {data?.keys.map((key) => (
            <div
              key={`${key.project}/${key.environment}/${key.keyRef}`}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm">
                {key.project} · {key.environment} · {key.keyRef} ·{" "}
                {key.expiresAt ? `expires ${key.expiresAt}` : "no expiry (legacy key)"}
              </span>
              <Button
                variant="outline"
                size="sm"
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
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Revoke keys
              </Button>
            </div>
          ))}
          {data?.pending.map((key) => (
            <p key={key.keyRef} className="text-sm text-muted-foreground">
              {key.project} · {key.environment} · {key.keyRef}: queued {key.queuedAt},{" "}
              {key.attempts} attempts{key.lastError ? ` (${key.lastError})` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
