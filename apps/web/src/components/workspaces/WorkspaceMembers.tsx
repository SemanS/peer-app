import type {
  EnvironmentId,
  PeerRemovalPlan,
  PeerWorkspaceMembers,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { useState } from "react";
import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { FoldedSettingsRow, NestedRowTitle, SettingsRowError } from "./PeerSettingsRows";
import { failureMessage } from "./WorkspaceAccess";
import { MemberKeys } from "./MemberKeys";
import {
  memberActions,
  removalConfirmation,
  pendingRevocationsWarning,
} from "./workspaceMembers.logic";
import { withFinally } from "~/lib/withFinally";

/** What to do once a removal went through; see `confirmRemoval`. */
type AfterRemoval = () => Promise<void>;
const NOTHING_AFTER: AfterRemoval = async () => {};

/** All membership management belongs to core; disabling Audit keeps this section available. */
export function WorkspaceMembers({
  environmentId,
  workspace,
  email,
  confirmRemoval,
  showInvites = true,
  onInvited,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly email: string | null;
  /**
   * Asks the person before a member is removed, in place of the plain confirmation: the settings
   * area asks about the projects that still name them. Resolves null when they back out, else what
   * to do once the removal succeeded.
   */
  readonly confirmRemoval?: (
    member: PeerWorkspaceMembers["members"][number],
    plan: PeerRemovalPlan,
  ) => Promise<AfterRemoval | null>;
  /** Pending invitations show here unless the page lists invitations on their own. */
  readonly showInvites?: boolean;
  readonly onInvited?: () => void;
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
    await withFinally(
      async () => {
        try {
          await action();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      },
      () => {
        setBusy(false);
      },
    );
  };
  /** The person's answer to a removal: what to do once it went through, or null for no. */
  const askToRemove = async (
    member: PeerWorkspaceMembers["members"][number],
    plan: PeerRemovalPlan,
  ): Promise<AfterRemoval | null> => {
    if (confirmRemoval !== undefined) return confirmRemoval(member, plan);
    const yes = await ensureLocalApi().dialogs.confirm(
      removalConfirmation(workspace.name, member.email, plan),
    );
    return yes ? NOTHING_AFTER : null;
  };
  const warning = pendingRevocationsWarning(data?.pendingRevocations);
  if (workspace.role === "member") return null;
  return (
    <FoldedSettingsRow
      title={<NestedRowTitle under="workspace">Members</NestedRowTitle>}
      label={`the members of ${workspace.name}`}
      description="Roles, invites and removals. Removing someone revokes their shared-capacity keys."
      open={open}
      busy={busy}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void run(load);
      }}
    >
      <Button
        className="self-start"
        variant="outline"
        size="xs"
        disabled={busy}
        onClick={() => void run(load)}
      >
        {busy ? "Loading…" : "Refresh members"}
      </Button>
      {warning ? (
        <p role="status" className="text-xs text-muted-foreground">
          {warning}
        </p>
      ) : null}
      {error ? <SettingsRowError>{error}</SettingsRowError> : null}
      {data === null ? null : (
        <ul className="divide-y divide-border/60">
          {data.members.map((member) => {
            const actions = memberActions(workspace.role, member.role, member.email === email);
            return (
              <li key={member.email} className="flex flex-col gap-2 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-sm">
                    {member.name ?? member.email}
                    <span className="text-muted-foreground">
                      {" "}
                      · {member.email} · {member.role} · {member.keys ?? 0} keys
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {actions.changeRole ? (
                      <div className="w-36">
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
                                input: {
                                  workspace: workspace.slug,
                                  email: member.email,
                                  role: next,
                                },
                              });
                              const failure = failureMessage(result);
                              if (failure) setError(failure);
                              else await load();
                            });
                          }}
                        >
                          <SelectTrigger size="xs" aria-label={`Change role for ${member.email}`}>
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
                        size="xs"
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
                            const after = await askToRemove(member, plan.value);
                            if (after === null) return;
                            const result = await remove({
                              environmentId,
                              input: { workspace: workspace.slug, email: member.email },
                            });
                            const failure = failureMessage(result);
                            if (failure) setError(failure);
                            else {
                              await load();
                              await after();
                            }
                          })
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                <MemberKeys
                  environmentId={environmentId}
                  workspace={workspace.slug}
                  email={member.email}
                />
              </li>
            );
          })}
          {(showInvites ? data.invites : []).map((pending) => (
            <li
              key={pending.email}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <span className="text-sm">
                {pending.email}
                <span className="text-muted-foreground"> · invited as {pending.role}</span>
              </span>
              <Button
                size="xs"
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
            </li>
          ))}
          {data.removed?.map((removed) => (
            <li
              key={removed.email}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <span className="text-sm">
                {removed.email}
                <span className="text-muted-foreground"> · removed</span>
              </span>
              <Button
                size="xs"
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
                    else if (result._tag === "Success") {
                      onInvited?.();
                      await load();
                      if (result.value.delivery?.state === "failed")
                        setError(
                          `Invitation created, but could not email ${removed.email}: ${result.value.delivery.error ?? "Use Resend in Invitations to try again."}`,
                        );
                    }
                  })
                }
              >
                {removed.invited ? "Invited back" : "Invite back"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </FoldedSettingsRow>
  );
}
