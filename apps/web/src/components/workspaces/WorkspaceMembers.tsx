import type { EnvironmentId, PeerWorkspaceMembers, PeerWorkspaceState } from "@t3tools/contracts";
import { useState } from "react";
import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { failureMessage } from "./WorkspaceAccess";
import { MemberKeys } from "./MemberKeys";
import {
  memberActions,
  removalConfirmation,
  pendingRevocationsWarning,
} from "./workspaceMembers.logic";

/** All membership management belongs to core; disabling Audit keeps this section available. */
export function WorkspaceMembers({
  environmentId,
  workspace,
  email,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly email: string | null;
}) {
  const members = useAtomCommand(serverEnvironment.peerHubMembers, { reportFailure: false });
  const preview = useAtomCommand(serverEnvironment.peerHubRemovalPlan, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.peerHubRemoveMember, { reportFailure: false });
  const role = useAtomCommand(serverEnvironment.peerHubSetMemberRole, { reportFailure: false });
  const withdraw = useAtomCommand(serverEnvironment.peerHubWithdrawInvite, {
    reportFailure: false,
  });
  const invite = useAtomCommand(serverEnvironment.peerHubInvite, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PeerWorkspaceMembers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const result = await members({ environmentId, input: { workspace: workspace.slug } });
    if (result._tag === "Success") setData(result.value);
    else {
      setData(null);
      setError(failureMessage(result));
    }
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const warning = pendingRevocationsWarning(data?.pendingRevocations);
  if (workspace.role === "member") return null;
  return (
    <div className="space-y-3 py-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setOpen(!open);
          if (!open) void run(load);
        }}
      >
        Members · {workspace.name}
      </Button>
      {!open ? null : (
        <div className="space-y-3 pl-4">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(load)}>
            {busy ? "Loading…" : "Refresh members"}
          </Button>
          {warning ? (
            <p role="status" className="text-sm text-muted-foreground">
              {warning}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {data?.members.map((member) => {
            const actions = memberActions(workspace.role, member.role, member.email === email);
            return (
              <div key={member.email} className="space-y-2 border-b border-border pb-3">
                <p className="text-sm">
                  {member.name ?? member.email} · {member.email} · {member.role} ·{" "}
                  {member.keys ?? 0} keys
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {actions.changeRole ? (
                    <div className="w-40">
                      <Select
                        value={member.role}
                        disabled={busy}
                        onValueChange={(next) => {
                          if (
                            (next !== "owner" && next !== "admin" && next !== "member") ||
                            next === member.role
                          )
                            return;
                          void run(async () => {
                            if (
                              !(await ensureLocalApi().dialogs.confirm(
                                `Change ${member.email}'s role in ${workspace.name} from ${member.role} to ${next}?`,
                              ))
                            )
                              return;
                            const result = await role({
                              environmentId,
                              input: { workspace: workspace.slug, email: member.email, role: next },
                            });
                            const failure = failureMessage(result);
                            if (failure) setError(failure);
                            else await load();
                          });
                        }}
                      >
                        <SelectTrigger size="sm" aria-label={`Change role for ${member.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                          {(workspace.role === "owner"
                            ? ["owner", "admin", "member"]
                            : ["admin", "member"]
                          ).map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                  ) : null}
                  {actions.remove ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const plan = await preview({
                            environmentId,
                            input: { workspace: workspace.slug, email: member.email },
                          });
                          if (plan._tag !== "Success") {
                            setError(failureMessage(plan));
                            return;
                          }
                          if (!("unsupported" in plan.value) && !plan.value.canRemove) {
                            setError(plan.value.reason ?? "This member cannot be removed.");
                            return;
                          }
                          if (
                            !(await ensureLocalApi().dialogs.confirm(
                              removalConfirmation(workspace.name, member.email, plan.value),
                            ))
                          )
                            return;
                          const result = await remove({
                            environmentId,
                            input: { workspace: workspace.slug, email: member.email },
                          });
                          const failure = failureMessage(result);
                          if (failure) setError(failure);
                          else await load();
                        })
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                <MemberKeys
                  environmentId={environmentId}
                  workspace={workspace.slug}
                  email={member.email}
                />
              </div>
            );
          })}
          {data?.invites.map((pending) => (
            <div key={pending.email} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                Invite: {pending.email} · {pending.role}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await withdraw({
                      environmentId,
                      input: { workspace: workspace.slug, email: pending.email },
                    });
                    const failure = failureMessage(result);
                    if (failure) setError(failure);
                    else await load();
                  })
                }
              >
                Withdraw
              </Button>
            </div>
          ))}
          {data?.removed?.map((removed) => (
            <div key={removed.email} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Removed: {removed.email}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || removed.invited}
                onClick={() =>
                  void run(async () => {
                    const result = await invite({
                      environmentId,
                      input: { workspace: workspace.slug, email: removed.email },
                    });
                    const failure = failureMessage(result);
                    if (failure) setError(failure);
                    else await load();
                  })
                }
              >
                {removed.invited ? "Invited back" : "Invite back"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
