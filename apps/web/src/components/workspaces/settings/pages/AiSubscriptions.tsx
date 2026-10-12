import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../../../hooks/useLocalStorage";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../../../state/server";
import { AddPlanRow, BlockedCard, PlansCard, ProjectUseRow } from "../AiSubscriptionsParts";
import {
  addPlanEdit,
  detectedPlans,
  firstBlocked,
  nothingBlockedText,
  personKey,
  readPlans,
  removePlanEdit,
  whereYouCanUse,
  type PlanEdit,
  notMineKey,
} from "../aiSubscriptions.logic";
import { NotSaved, OwnersNote, PageSection, SettingsReadError } from "../CapacityCoordinationParts";
import { DetectedPlans } from "../DetectedPlans";
import { DraftSaveBar } from "../DraftBar";
import type { WorkspacePageProps } from "../pageProps";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/** The detected plans a person said are not theirs, by environment: what an agent reports is that computer's. */
const NotMine = Schema.Array(Schema.String);
const NOTHING_HIDDEN: ReadonlyArray<string> = [];
const NO_DETECTED = { offered: [], hidden: [] } as const;

const Quiet = ({ children }: { readonly children: string }) => (
  <p role="status" className="text-sm text-muted-foreground">
    {children}
  </p>
);

/**
 * Which AI plans the person has (design artboard 22): information for Peer, never a login. The plans
 * are the person's own entry of the workspace's settings, changed through a draft that a review
 * saves; the Hub lets a person change only their own. Under them, where each plan may be used in
 * the projects they are on (from the manifest and `hubPolicy.ts`'s rules, so it follows the draft),
 * and why an agent cannot start on a plan, with the two ways out. Against a Hub without settings the
 * plans are not known: the page says so and shows what the manifest says of each project. Above the
 * plans, the plans Claude Code and Codex on this computer report: each is added by a click, or put
 * aside as not theirs, and never read from anything but the status those agents already give.
 */
export function AiSubscriptions({ environmentId, status, workspace }: WorkspacePageProps) {
  const view = useSettingsView(workspace.slug);
  const { me } = view;
  const key = me === null ? "" : personKey(view.document, me);
  const draft = useSettingsDraft(view, { slice: ["people", key] });

  // The plans are known once the person's settings are read; a person with none has no entry.
  const read = view.hubHasSettings && view.document !== null && me !== null;
  const waiting = view.hubHasSettings && !read && view.loading;
  const canEdit = read && view.canChange(["people", key]);
  const rows = read ? readPlans(draft.value) : [];
  const where = whereYouCanUse(
    workspace.projects.map(({ project }) => project),
    read ? rows : null,
  );
  const blocked = firstBlocked(where);
  const write = (planEdit: PlanEdit | null) => {
    if (planEdit !== null) draft.set(planEdit.path, planEdit.value);
  };
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const [notMine, setNotMine] = useLocalStorage(notMineKey(environmentId), NOTHING_HIDDEN, NotMine);
  // Offered only once the person's plans are known and they may change them: a plan is "not yet
  // there" only against a list that was read.
  const detected = canEdit ? detectedPlans(providers, rows, notMine) : NO_DETECTED;

  const plansNote = waiting
    ? "Loading your plans…"
    : !read
      ? view.hubHasSettings
        ? "Your plans aren’t available right now."
        : "This Hub doesn’t show your plans here."
      : rows.length === 0
        ? "You haven’t added a plan yet."
        : null;

  return (
    <PeerSettingsPage
      title="AI subscriptions"
      description="Tell Peer which plans you have. It’s information only: Peer never reads how you sign in, and never shares, proxies or pools your plan."
    >
      <SettingsUnavailableNote />
      {view.error === null || read ? null : (
        <SettingsReadError project={workspace.name} error={view.error} onRetry={view.refresh} />
      )}

      <DetectedPlans
        offered={detected.offered}
        hidden={detected.hidden}
        canAdd={canEdit}
        onAdd={(plan) => write(addPlanEdit(draft.value, plan.harness, plan.plan))}
        onDismiss={(plan) => setNotMine((current) => [...new Set([...current, plan.key])])}
        onRestore={() => setNotMine(NOTHING_HIDDEN)}
      />

      <PageSection title="Your plans" aside={draft.dirty > 0 ? <NotSaved /> : undefined}>
        <PlansCard
          rows={rows}
          canEdit={canEdit}
          note={plansNote}
          onRemove={(row) => write(removePlanEdit(draft.value, row.index))}
        >
          {canEdit ? (
            <AddPlanRow
              plans={rows}
              onAdd={(harness, plan) => write(addPlanEdit(draft.value, harness, plan))}
            />
          ) : null}
        </PlansCard>
        {read && !canEdit ? <OwnersNote owners={view.ownersOf(["people", key])} /> : null}
      </PageSection>

      <PageSection title="Where you can use them">
        {waiting ? (
          <Quiet>Loading…</Quiet>
        ) : where.length === 0 ? (
          <Quiet>{`You’re not on a project in ${workspace.name} yet.`}</Quiet>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {where.map((row) => (
              <ProjectUseRow
                key={row.project}
                row={row}
                environmentId={environmentId}
                status={status}
                workspace={workspace.slug}
                email={me}
                currency={workspace.currency}
              />
            ))}
          </div>
        )}
      </PageSection>

      <PageSection title="When an agent can’t start on your plan">
        {waiting ? (
          <Quiet>Loading…</Quiet>
        ) : blocked === null ? (
          <Quiet>
            {nothingBlockedText({ projects: where.length, plans: read ? rows.length : null })}
          </Quiet>
        ) : (
          <BlockedCard
            key={blocked.project}
            blocked={blocked}
            environmentId={environmentId}
            status={status}
            workspace={workspace}
            email={me}
          />
        )}
      </PageSection>

      <DraftSaveBar draft={draft} scope="AI plans" />
    </PeerSettingsPage>
  );
}
