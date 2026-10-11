import type { PeerSettingsProposal } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { ChevronRightIcon, FileDiffIcon } from "lucide-react";
import { useId, useState } from "react";

import { useNowMinute } from "../../../hooks/useNowMinute";
import { cn } from "../../../lib/utils";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button } from "../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Textarea } from "../../ui/textarea";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
  PeerFenced,
  PeerStackedField,
} from "../PeerDialog";
import { TONE_SURFACE } from "../signals";
import { failureMessage } from "../WorkspaceAccess";
import { reportFailure } from "../workFeedback";
import { ChangeLines } from "./ChangeLines";
import { useOptionalPeerSettings, usePeerSettings } from "./PeerSettingsContext";
import { parsePeerSettingsPath } from "./peerSettings.logic";
import {
  DECLINE_MAX,
  bannerText,
  proposalPageOf,
  proposalsOnPage,
  proposedByText,
  proposerText,
  splitProposals,
} from "./proposals.logic";
import { scopeNameOf } from "./reviewChanges.logic";
import { proposalsKey } from "./settingsView.logic";
import { useRetained } from "./useRetained";
import { useReviewChanges } from "./useReviewChanges";
import { useSettingsView, type SettingsView } from "./useSettingsView";

/** Declines a proposal with a reason its proposer sees. */
function DeclineProposalDialog({
  workspace,
  proposal,
  name,
  onClose,
  onDeclined,
}: {
  readonly workspace: string;
  readonly proposal: PeerSettingsProposal;
  readonly name: string;
  readonly onClose: () => void;
  readonly onDeclined: () => void;
}) {
  const { environmentId } = usePeerSettings();
  const decline = useAtomCommand(serverEnvironment.peerSettings.declineProposal, {
    reportFailure: false,
  });
  const formId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <PeerDialogHeader
          icon={FileDiffIcon}
          title={`Decline ${name}’s proposal`}
          context={<span className="break-words">{proposal.message}</span>}
        />
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError(null);
              void decline({
                environmentId,
                input: {
                  workspace,
                  id: proposal.id,
                  ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
                },
              })
                .then((result) => {
                  const failure = failureMessage(result);
                  if (failure === null) {
                    onDeclined();
                    onClose();
                  } else setError(failure);
                })
                .finally(() => setBusy(false));
            }}
          >
            <PeerStackedField
              label={`Tell ${name} why (optional)`}
              htmlFor={`${formId}-reason`}
              aside={`${reason.length}/${DECLINE_MAX}`}
            >
              <Textarea
                id={`${formId}-reason`}
                autoFocus
                value={reason}
                disabled={busy}
                maxLength={DECLINE_MAX}
                onChange={(event) => setReason(event.target.value)}
              />
            </PeerStackedField>
            {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter note="The proposal closes. Nothing in the settings changes.">
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Declining…" : "Decline proposal"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** One pending proposal: who proposed it, why, what it changes, and what the person may do with it. */
function ProposalRow({
  proposal,
  view,
  onReview,
  onChanged,
}: {
  readonly proposal: PeerSettingsProposal;
  readonly view: SettingsView;
  /** Opens the review that applies the proposal; the list owns it, since the row goes once applied. */
  readonly onReview: (proposal: PeerSettingsProposal, name: string) => void;
  readonly onChanged: () => void;
}) {
  const { environmentId } = usePeerSettings();
  const withdraw = useAtomCommand(serverEnvironment.peerSettings.withdrawProposal, {
    reportFailure: false,
  });
  const [declining, setDeclining] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const name = view.nameOf(proposal.by);
  const isAsk = proposal.lines.length === 0;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-foreground">{proposerText(proposal, name)}</span>
        <time dateTime={proposal.at} className="text-xs text-muted-foreground">
          {formatRelativeTimeLabel(proposal.at)}
        </time>
        {proposal.canDecide ? null : (
          <span className="text-xs text-muted-foreground">waits for {proposal.owners}</span>
        )}
      </div>
      <p className="text-sm break-words text-foreground">“{proposal.message}”</p>
      {isAsk ? (
        <p className="text-xs text-muted-foreground">
          This asks for something rather than proposing a change.
        </p>
      ) : (
        <ChangeLines lines={proposal.lines} />
      )}
      {proposal.instruction === null || proposal.instruction === undefined ? null : (
        <Collapsible>
          <CollapsibleTrigger
            type="button"
            className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon aria-hidden className="size-3.5 group-data-panel-open:rotate-90" />
            What {name} asked
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-2">
              <PeerFenced who={name} note={null}>
                {proposal.instruction}
              </PeerFenced>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {proposal.canDecide && !isAsk ? (
          <Button size="xs" onClick={() => onReview(proposal, name)}>
            Review
          </Button>
        ) : null}
        {proposal.canDecide ? (
          <Button size="xs" variant="outline" onClick={() => setDeclining(true)}>
            Decline…
          </Button>
        ) : null}
        {proposal.mine ? (
          <Button
            size="xs"
            variant="outline"
            disabled={withdrawing}
            onClick={() => {
              setWithdrawing(true);
              void withdraw({
                environmentId,
                input: { workspace: view.workspace, id: proposal.id },
              })
                .then((result) => {
                  if (reportFailure("Could not withdraw the proposal", result)) onChanged();
                })
                .finally(() => setWithdrawing(false));
            }}
          >
            {withdrawing ? "Withdrawing…" : "Withdraw"}
          </Button>
        ) : null}
      </div>
      {declining ? (
        <DeclineProposalDialog
          workspace={view.workspace}
          proposal={proposal}
          name={name}
          onClose={() => setDeclining(false)}
          onDeclined={onChanged}
        />
      ) : null}
    </li>
  );
}

/**
 * The pending proposals of a workspace that belong to one scope (`workspace`, `project:<id>` or
 * `person:<email>`), as a banner: "2 proposals wait for you" for the owner who decides them,
 * "Your proposal waits for Booking's leads and admins" for the one who made them. Review opens the
 * list; each proposal is reviewed in the same dialog as a save and applied from there, or declined
 * with a reason, or withdrawn by its proposer. Renders nothing while none waits.
 */
export function Proposals({
  workspace,
  scope,
}: {
  readonly workspace: string;
  readonly scope: string;
}) {
  const { environmentId, status } = usePeerSettings();
  const view = useSettingsView(workspace);
  const person = status.email;
  const query = useEnvironmentQuery(
    view.hubHasSettings && person !== null
      ? serverEnvironment.peerSettings.proposals({
          environmentId,
          person,
          // What the status counts keys the list: it reads again when a proposal is decided,
          // withdrawn or applied, whoever proposed it.
          input: { workspace, state: "pending", ...proposalsKey(status, workspace) },
        })
      : null,
  );
  const read = useRetained(query.data, `${environmentId}/${person ?? ""}/${workspace}`);
  const [open, setOpen] = useState(false);
  const workspaceName =
    status.workspaces.find((entry) => entry.slug === workspace)?.name ?? workspace;
  // The review lives here, not in a row: an applied proposal leaves the list, and its review must
  // stay open to show that it saved.
  const review = useReviewChanges({
    scope: workspaceName,
    onSaved: () => {
      view.refresh();
      query.refresh();
    },
  });
  // Times in the rows read "5m ago": the clock moves them on.
  useNowMinute();
  if (!view.hubHasSettings || read === null) return null;
  const { deciding, waiting: mine } = splitProposals(proposalsOnPage(read.proposals, scope));
  const text = bannerText(deciding, mine);
  const reviewProposal = (proposal: PeerSettingsProposal, name: string) =>
    review.open(
      { kind: "proposal", workspace, id: proposal.id },
      {
        scope: scopeNameOf(proposal.lines, workspaceName),
        context: proposedByText(proposal, name),
      },
    );
  return (
    <>
      {text === null ? null : (
        <section
          aria-label="Proposals"
          className={cn(
            "flex flex-col gap-3 rounded-xl border px-4 py-3",
            TONE_SURFACE[deciding.length > 0 ? "needs" : "neutral"],
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{text}</p>
            <Button size="xs" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Hide" : "Show"}
            </Button>
          </div>
          {open ? (
            <ul
              aria-label="Pending proposals"
              className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card"
            >
              {[...deciding, ...mine].map((proposal) => (
                <ProposalRow
                  key={proposal.id}
                  proposal={proposal}
                  view={view}
                  onReview={reviewProposal}
                  onChanged={query.refresh}
                />
              ))}
            </ul>
          ) : null}
        </section>
      )}
      {review.dialog}
    </>
  );
}

/**
 * The proposals banner of the page being shown, for the scope that page is of (a project's pages the
 * project, a workspace's the workspace, AI subscriptions the person); nothing on pages with no
 * settings to propose changes to. Pages of the area get it from their frame.
 */
export function ProposalsBanner() {
  const peer = useOptionalPeerSettings();
  if (peer === null) return null;
  return <ProposalsOfThisPage email={peer.status.email} />;
}

function ProposalsOfThisPage({ email }: { readonly email: string | null }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const page = proposalPageOf(parsePeerSettingsPath(pathname), email);
  if (page === null) return null;
  return (
    <Proposals
      key={`${page.workspace}/${page.scope}`}
      workspace={page.workspace}
      scope={page.scope}
    />
  );
}
