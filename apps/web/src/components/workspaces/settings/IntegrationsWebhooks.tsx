/**
 * The Webhooks card of the Integrations page (design artboard 19): how many of the twenty the
 * workspace has, Add webhook, and a row for each with where it sends, what it sends, how its
 * deliveries stand, Requeue for the failed ones and Edit. A row opens to the deliveries behind its
 * status, with a test delivery. The rows are the settings document's webhooks together with what the
 * webhooks plugin knows of them; a Hub without the settings feature lists them, and requeues, but
 * changes nothing.
 */
import {
  canRequeue,
  eventLabel,
  failureSentence,
  orderDeliveries,
  webhookActionMessage,
} from "@t3tools/client-runtime/peer/webhooks";
import type { EnvironmentId, PeerWebhook, PeerWorkspaceState } from "@t3tools/contracts";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Button, InlineButton } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { PeerCard } from "../PeerPageHeader";
import { failureMessage } from "../WorkspaceAccess";
import { webhookAtoms } from "../webhooks/atoms";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import {
  attemptsText,
  webhookCountText,
  webhookRows,
  type WebhookRowView,
} from "./integrations.logic";
import { useSettingsView } from "./useSettingsView";
import { WebhookDialog } from "./WebhookDialog";
import { MAX_WEBHOOKS, projectChoices, savedHooks, type SavedHook } from "./webhookForm.logic";

const DOT: Readonly<Record<WebhookRowView["status"]["tone"], string>> = {
  ok: "size-2 shrink-0 rounded-full bg-success",
  warn: "size-2 shrink-0 rounded-full bg-warning",
  quiet: "size-2 shrink-0 rounded-full bg-muted-foreground/40",
};

const TEXT: Readonly<Record<WebhookRowView["status"]["tone"], string>> = {
  ok: "text-sm text-muted-foreground",
  warn: "text-sm text-warning-foreground",
  quiet: "text-sm text-muted-foreground",
};

/**
 * What stands behind a row's status: where it sends, how many deliveries failed or wait, the last
 * failure, a test delivery, and the failed deliveries one by one with a Requeue for each.
 */
export function WebhookDetails({
  environmentId,
  workspace,
  entry,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly entry: PeerWebhook;
  readonly onChanged: () => void;
}) {
  const deliveries = useEnvironmentQuery(
    webhookAtoms.deliveries({
      environmentId,
      input: { workspace, id: entry.id, state: "failed", limit: 100 },
    }),
  );
  const requeue = useAtomCommand(webhookAtoms.requeue, { reportFailure: false });
  const test = useAtomCommand(webhookAtoms.test, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The row's status and counts come from the webhook list, the rows below from the deliveries:
  // reading one without the other leaves the two telling different stories.
  const refresh = () => {
    onChanged();
    deliveries.refresh();
  };

  const act = async (action: "test" | "requeue", delivery?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const input = {
        environmentId,
        input: { workspace, id: entry.id, ...(delivery === undefined ? {} : { delivery }) },
      };
      const result = action === "test" ? await test(input) : await requeue(input);
      const failure = failureMessage(result);
      if (failure !== null) setMessage(failure);
      else if (result._tag === "Success") {
        setMessage(webhookActionMessage(result.value));
        refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const { health } = entry;
  return (
    <div className="flex flex-col gap-2 border-t border-border bg-muted/20 px-3 py-2.5">
      <p className="text-sm text-muted-foreground">
        {entry.destination.host === undefined
          ? "Its destination needs setup."
          : `Sends to ${entry.destination.host}.`}{" "}
        {health.failed} failed · {health.pending} pending
        {health.lastDeliveredAt === null
          ? " · no delivery yet"
          : ` · last delivered ${formatRelativeTimeLabel(health.lastDeliveredAt)}`}
      </p>
      {health.lastFailure === null ? null : (
        <p className="text-sm text-muted-foreground">{failureSentence(health.lastFailure)}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={
            busy ||
            !entry.enabled ||
            entry.destination.state !== "ok" ||
            entry.signing === "missing"
          }
          onClick={() => void act("test")}
        >
          Send test
        </Button>
        <InlineButton tone="muted" onClick={refresh}>
          Refresh
        </InlineButton>
      </div>
      {message === null ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {deliveries.error === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {deliveries.error}
        </p>
      )}
      {deliveries.isPending && deliveries.data === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading failures…
        </p>
      ) : null}
      {deliveries.data?.deliveries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No failed deliveries.</p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {orderDeliveries(deliveries.data?.deliveries ?? []).map((delivery) => (
          <li
            key={delivery.id}
            className="flex flex-wrap items-center justify-between gap-2 py-1.5"
          >
            <span className="min-w-0 text-sm">
              <span className="text-foreground">
                {eventLabel(delivery.event)}
                {delivery.title === null ? "" : ` · ${delivery.title}`}
              </span>
              <span className="block text-muted-foreground">
                {failureSentence(delivery.failure)} · {attemptsText(delivery.attempts)}
              </span>
            </span>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || !canRequeue(entry, delivery)}
              onClick={() => void act("requeue", delivery.id)}
            >
              Requeue
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WebhooksCard({
  environmentId,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
}) {
  useRelativeTimeTick(60_000);
  const view = useSettingsView(workspace.slug);
  const list = useEnvironmentQuery(
    webhookAtoms.list({ environmentId, input: { workspace: workspace.slug } }),
  );
  const requeue = useAtomCommand(webhookAtoms.requeue, { reportFailure: false });
  // The webhook being edited as it was when the dialog opened (null for a new one), so the dialog
  // does not change under the person when the settings are read again after a save.
  const [dialog, setDialog] = useState<{
    readonly editing: { readonly id: string; readonly hook: SavedHook } | null;
  } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saved = savedHooks(view.hubHasSettings ? view.document : null);
  const names = new Map(
    projectChoices(
      view.document,
      workspace.projects.map(({ project }) => ({ id: project.id, name: project.name })),
    ).map((project) => [project.id, project.name] as const),
  );
  const rows = webhookRows({
    saved,
    list: list.data,
    listFailed: list.error !== null && list.data === null,
    workspaceName: workspace.name,
    projectName: (id) => names.get(id) ?? id,
  });
  const editable = view.hubHasSettings && view.document !== null && view.revision !== null;
  const full = rows.length >= MAX_WEBHOOKS;
  const edit = (id: string) => {
    const hook = saved.get(id);
    if (hook !== undefined) setDialog({ editing: { id, hook } });
  };

  const send = async (row: WebhookRowView) => {
    setBusy(row.id);
    setNotice(null);
    try {
      const result = await requeue({
        environmentId,
        input: { workspace: workspace.slug, id: row.id },
      });
      const failure = failureMessage(result);
      if (failure !== null) setNotice(`Could not requeue ${row.title}: ${failure}`);
      else if (result._tag === "Success") {
        setNotice(`${row.title}: ${webhookActionMessage(result.value)}`);
        list.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PeerCard aria-label="Webhooks">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-sm font-semibold text-foreground">Webhooks</h2>
          <span className="text-xs text-muted-foreground">
            {webhookCountText(rows.length, MAX_WEBHOOKS)}
          </span>
          <div className="ms-auto flex items-center gap-3">
            <InlineButton tone="muted" onClick={list.refresh}>
              Refresh
            </InlineButton>
            {editable ? (
              full ? (
                <Tooltip>
                  <TooltipTrigger
                    render={<span tabIndex={0} className="inline-flex rounded-md outline-none" />}
                  >
                    <Button size="sm" variant="outline" disabled>
                      <PlusIcon aria-hidden />
                      Add webhook
                    </Button>
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    A workspace has up to {MAX_WEBHOOKS} webhooks.
                  </TooltipPopup>
                </Tooltip>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setDialog({ editing: null })}>
                  <PlusIcon aria-hidden />
                  Add webhook
                </Button>
              )
            ) : null}
          </div>
        </div>
        {list.error === null ? null : (
          <p role="alert" className="text-sm text-destructive-foreground">
            Could not read the webhooks’ deliveries: {list.error}{" "}
            <InlineButton tone="muted" onClick={list.refresh}>
              Try again
            </InlineButton>
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {list.data === null && list.error === null
              ? "Loading webhooks…"
              : editable
                ? "No webhooks yet. Add one to send workspace events to Slack, Teams or an address of your own."
                : "No webhooks."}
          </p>
        ) : (
          <ul
            aria-label="Webhooks"
            className="flex flex-col divide-y divide-border rounded-lg border border-border"
          >
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                  <span className="flex min-w-48 flex-1 flex-col">
                    <span className="text-sm font-medium text-foreground">{row.title}</span>
                    <span className="text-xs text-muted-foreground">{row.meta}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={DOT[row.status.tone]} />
                    <span className={TEXT[row.status.tone]}>{row.status.text}</span>
                  </span>
                  {row.requeue > 0 ? (
                    <Button
                      size="xs"
                      variant="warning-outline"
                      disabled={busy === row.id}
                      aria-label={`Requeue the failed deliveries of ${row.title}`}
                      onClick={() => void send(row)}
                    >
                      Requeue
                    </Button>
                  ) : null}
                  {row.entry === null ? null : (
                    <Button
                      size="xs"
                      variant="ghost-muted"
                      aria-expanded={open === row.id}
                      aria-label={`Deliveries of ${row.title}`}
                      onClick={() => setOpen(open === row.id ? null : row.id)}
                    >
                      <ChevronRightIcon
                        aria-hidden
                        className={open === row.id ? "rotate-90" : undefined}
                      />
                      Details
                    </Button>
                  )}
                  {editable && row.editable ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Edit ${row.title}`}
                      onClick={() => edit(row.id)}
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
                {open === row.id && row.entry !== null ? (
                  <WebhookDetails
                    environmentId={environmentId}
                    workspace={workspace.slug}
                    entry={row.entry}
                    onChanged={list.refresh}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {notice === null ? null : (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
      </PeerCard>
      {dialog === null ? null : (
        <WebhookDialog
          environmentId={environmentId}
          workspace={workspace}
          editing={dialog.editing}
          takenIds={new Set(rows.map((row) => row.id))}
          onChanged={() => {
            view.refresh();
            list.refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
