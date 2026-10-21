import type { EnvironmentId, PeerHubStatus, PeerWorkspaceState } from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useClientSettings } from "../../../../hooks/useSettings";
import { useEnvironmentQuery } from "../../../../state/query";
import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { formatRelativeTimeLabel, formatShortTimestamp } from "../../../../timestampFormat";
import { SettingsSection, useRelativeTimeTick } from "../../../settings/settingsLayout";
import { InlineButton } from "../../../ui/button";
import { toastManager } from "../../../ui/toast";
import { failureMessage } from "../../WorkspaceAccess";
import { NotSaved, PageSection, SettingsReadError } from "../CapacityCoordinationParts";
import { DraftSaveBar } from "../DraftBar";
import type { WorkspacePageProps } from "../pageProps";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { AdminOnlyNote, PeerSettingsPage, RequirePlugin } from "../PeerSettingsPage";
import { HostedSettings } from "../PluginSlots";
import {
  DEFAULT_KEY_SECRET,
  adminUrlEdit,
  currencyEdits,
  emptyPoolsText,
  manifestGateway,
  masterKeyText,
  modelRows,
  newPoolEdit,
  poolModelsWith,
  poolUses,
  rateEdit,
  readCatalogPools,
  readCurrency,
  readGateway,
  syncState,
  testOutcome,
  urlEdits,
  type Edit,
  type TestOutcome,
} from "../sharedCapacity.logic";
import {
  ConnectionTest,
  GatewayFields,
  MasterKeyCard,
  MasterKeyDialog,
  NewPoolDialog,
  PoolsTable,
  SyncBanner,
} from "../SharedCapacityParts";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/**
 * A workspace's Shared capacity page (design artboard 16): the gateway its API keys sit behind, its
 * address and currency, the master key and a test of the connection, and the model pools projects
 * draw their budgets from. Admins change all of it (the address, currency and pools in a draft a
 * review saves; the key as the secret it is); everyone else is told who does and reads how capacity
 * works. Without the settings feature on the Hub the page says what the manifest knows of the
 * gateway and nothing is editable.
 */
export function SharedCapacity({ environmentId, status, workspace }: WorkspacePageProps) {
  const admin = isWorkspaceAdmin(workspace.role);
  const explanation = (
    <RequirePlugin status={status} plugin="capacity" title="Shared capacity">
      <SettingsSection title="Capacity details" hideTitle>
        <HostedSettings host="capacity" environmentId={environmentId} status={status} />
      </SettingsSection>
    </RequirePlugin>
  );
  return (
    <PeerSettingsPage
      title="Shared capacity"
      description={`${workspace.name}’s own API keys behind one gateway. Personal subscriptions are never pooled here.`}
    >
      {admin ? (
        <GatewayAndPools
          environmentId={environmentId}
          status={status}
          workspace={workspace}
          footer={explanation}
        />
      ) : (
        <>
          <AdminOnlyNote workspace={workspace} />
          {explanation}
        </>
      )}
    </PeerSettingsPage>
  );
}

/** What an admin sees: the gateway and the pools, over the draft that saves them. */
function GatewayAndPools({
  environmentId,
  status,
  workspace,
  footer,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
  /** After the sections, before the bar. */
  readonly footer: ReactNode;
}) {
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view);
  const { timestampFormat } = useClientSettings();
  // "synced 4m ago" is only true for a minute.
  useRelativeTimeTick(60_000);
  const person = status.email;
  const gatewayView = useEnvironmentQuery(
    view.hubHasSettings && person !== null
      ? serverEnvironment.peerSettings.gateway({
          environmentId,
          person,
          input: { workspace: workspace.slug },
        })
      : null,
  );
  const test = useAtomCommand(serverEnvironment.peerSettings.gatewayTest, { reportFailure: false });
  const syncGateway = useAtomCommand(serverEnvironment.peerSettings.gatewaySync, {
    reportFailure: false,
  });
  const putSecret = useAtomCommand(serverEnvironment.peerSettings.putSecret, {
    reportFailure: false,
  });
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  // The models the last successful test found: the table lists them even after a test that failed.
  const [onGateway, setOnGateway] = useState<ReadonlyArray<string> | null>(null);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [keyDialog, setKeyDialog] = useState(false);
  const [poolDialog, setPoolDialog] = useState(false);

  // A save may have changed the gateway (and every save reconciles it): read what it says again.
  const seenRevision = useRef(view.revision);
  const refreshGateway = gatewayView.refresh;
  useEffect(() => {
    if (seenRevision.current === view.revision) return;
    seenRevision.current = view.revision;
    refreshGateway();
  }, [view.revision, refreshGateway]);

  const document = view.hubHasSettings ? draft.document : null;
  const saved = view.document;
  const gateway = readGateway(document);
  const savedGateway = readGateway(saved);
  const currency = readCurrency(document);
  const pools = readCatalogPools(document);
  const savedPools = readCatalogPools(saved);
  const canEdit = document !== null && view.canChange(["gateway"]);
  const write = (edit: Edit) => draft.set(edit.path, edit.value);
  const now = new Date();
  const gw = gatewayView.data;

  const runTest = async () => {
    setTesting(true);
    const result = await test({ environmentId, input: { workspace: workspace.slug } });
    setTesting(false);
    const failure = failureMessage(result);
    if (failure !== null) {
      setOutcome({ tone: "error", text: `Could not connect: ${failure}`, models: null });
    } else if (result._tag === "Success") {
      const found = testOutcome(result.value);
      setOutcome(found);
      if (found.models !== null) setOnGateway(found.models);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    const result = await syncGateway({ environmentId, input: { workspace: workspace.slug } });
    setSyncing(false);
    setSyncError(failureMessage(result));
    gatewayView.refresh();
  };

  const storeKey = async (value: string): Promise<string | null> => {
    const result = await putSecret({
      environmentId,
      input: {
        workspace: workspace.slug,
        name: gateway?.masterKeySecret ?? DEFAULT_KEY_SECRET,
        value,
      },
    });
    const failure = failureMessage(result);
    if (failure !== null) return failure;
    gatewayView.refresh();
    toastManager.add({ type: "success", title: "Master key stored" });
    return null;
  };

  /** Why the connection cannot be tested: the Hub tests what it has saved, with the key it holds. */
  const testBlocked =
    gw === null
      ? "Reading the gateway…"
      : !gw.configured
        ? "Save the gateway’s address first."
        : draft.changed(["gateway"])
          ? "Save your changes first. The test uses what is saved."
          : !gw.masterKey.stored
            ? "Store the master key first."
            : null;

  if (!view.hubHasSettings) {
    const address = manifestGateway(workspace.projects);
    return (
      <>
        <SettingsUnavailableNote />
        {address === undefined ? null : (
          <p role="status" className="text-sm text-muted-foreground">
            Gateway {address} · {workspace.currency}
          </p>
        )}
        {footer}
        <DraftSaveBar draft={draft} scope={workspace.name} />
      </>
    );
  }
  if (document === null) {
    return (
      <>
        {view.error === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Reading {workspace.name}’s settings…
          </p>
        ) : (
          <SettingsReadError project={workspace.name} error={view.error} onRetry={view.refresh} />
        )}
        {footer}
        <DraftSaveBar draft={draft} scope={workspace.name} />
      </>
    );
  }

  const uses = poolUses(document, currency);
  const empty = emptyPoolsText(pools);
  return (
    <>
      <div className="flex flex-col gap-7">
        {gw !== null && gw.configured ? (
          <SyncBanner
            state={syncState(gw.sync, {
              now,
              clock: (iso) => formatShortTimestamp(iso, timestampFormat),
              ago: formatRelativeTimeLabel,
            })}
            busy={syncing}
            error={syncError}
            onSync={() => void runSync()}
          />
        ) : null}

        <PageSection
          title="Gateway"
          aside={
            draft.changed(["gateway"]) || draft.changed(["currency"]) ? <NotSaved /> : undefined
          }
        >
          <GatewayFields
            gateway={gateway}
            currency={currency}
            editable={canEdit}
            onUrl={(url) => urlEdits(gateway, url).forEach(write)}
            onAdminUrl={(url) => write(adminUrlEdit(url))}
            onRate={(rate) => write(rateEdit(rate))}
            onCurrency={(to) =>
              currencyEdits({
                to,
                gateway,
                saved: {
                  currency: readCurrency(saved),
                  usdPerUnit: savedGateway?.usdPerUnit,
                },
              }).forEach(write)
            }
          />
          <MasterKeyCard
            text={gw === null ? "" : masterKeyText(gw.masterKey, view.nameOf, now)}
            stored={gw?.masterKey.stored ?? false}
            loading={gw === null && gatewayView.error === null}
            canEdit={canEdit}
            onReplace={() => setKeyDialog(true)}
          />
          {gatewayView.error === null ? null : (
            <p role="alert" className="text-xs text-destructive-foreground">
              Could not read the gateway’s state: {gatewayView.error}{" "}
              <InlineButton tone="muted" onClick={gatewayView.refresh}>
                Try again
              </InlineButton>
            </p>
          )}
          <ConnectionTest
            disabledReason={testBlocked}
            busy={testing}
            outcome={outcome}
            onTest={() => void runTest()}
          />
        </PageSection>

        <PageSection
          title="Model pools"
          description="Pools group the models the gateway already has. A project’s budget uses one pool. To add a model, register it on the gateway first."
        >
          <PoolsTable
            rows={modelRows(pools, onGateway)}
            pools={pools}
            editable={canEdit}
            isNew={(pool) =>
              draft.dirty > 0 && !savedPools.some((existing) => existing.id === pool.id)
            }
            onToggle={(row, pool, on) =>
              write({
                path: ["capacity", pool.id, "models"],
                value: poolModelsWith(pool, pools, row.id, on),
              })
            }
          />
          {empty === null ? null : <p className="text-xs text-warning-foreground">{empty}</p>}
          <p className="text-xs text-muted-foreground">
            {uses.join(" ")}
            {uses.length > 0 && canEdit ? " " : null}
            {canEdit ? (
              <InlineButton tone="muted" onClick={() => setPoolDialog(true)}>
                New pool
              </InlineButton>
            ) : null}
          </p>
        </PageSection>
        {footer}
      </div>

      {keyDialog ? (
        <MasterKeyDialog
          replacing={gw?.masterKey.stored ?? false}
          secret={gateway?.masterKeySecret ?? DEFAULT_KEY_SECRET}
          onStore={storeKey}
          onClose={() => setKeyDialog(false)}
        />
      ) : null}
      {poolDialog ? (
        <NewPoolDialog
          taken={new Set(pools.map((pool) => pool.id))}
          onCreate={(id, name) => write(newPoolEdit(id, name))}
          onClose={() => setPoolDialog(false)}
        />
      ) : null}

      <DraftSaveBar
        draft={draft}
        scope={workspace.name}
        label={`${workspace.name} · Shared capacity`}
      />
    </>
  );
}
