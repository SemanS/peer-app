import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import type { ReadinessCheck, ReadinessMark } from "./providerStatus";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { FoldedSettingsSection } from "./FoldedSettingsSection";

const MARK = {
  yes: {
    Icon: CheckIcon,
    label: "Done",
    className: "bg-success/8 text-success-foreground dark:bg-success/16",
  },
  no: {
    Icon: XIcon,
    label: "Missing",
    className: "bg-destructive/8 text-destructive-foreground dark:bg-destructive/16",
  },
  unknown: { Icon: MinusIcon, label: "Not known", className: "bg-muted text-muted-foreground" },
} as const satisfies Record<ReadinessMark, unknown>;

function Mark({ mark }: { readonly mark: ReadinessMark }) {
  const { Icon, label, className } = MARK[mark];
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", className)}
    >
      <Icon aria-hidden className="size-3" />
    </span>
  );
}

/**
 * What a provider needs before Peer can start an agent on it, one line each with the server's own
 * word for it. The account a provider is signed in to comes from the card, which hides it until the
 * person asks, and shows after what the provider says.
 */
export function ProviderReadiness({
  checks,
  account,
}: {
  readonly checks: ReadonlyArray<ReadinessCheck>;
  /** The signed-in account, for the "Signed in" line when the provider reports one. */
  readonly account?: ReactNode;
}) {
  const id = useId();
  const attention = checks.filter((check) => check.mark !== "yes");
  const passed = checks.filter((check) => check.mark === "yes");
  const rows = (items: ReadonlyArray<ReadinessCheck>) =>
    items.map((check) => (
      <SettingsRow
        key={check.id}
        title={
          <span className="flex items-center gap-2">
            <Mark mark={check.mark} />
            {check.what}
          </span>
        }
        description={
          check.id === "signed-in" && check.mark === "yes" && account !== undefined ? (
            <>
              {check.detail} <span aria-hidden>·</span> {account}
            </>
          ) : (
            check.detail
          )
        }
      />
    ));
  return (
    <>
      {attention.length > 0 ? (
        <SettingsSection title="Readiness">{rows(attention)}</SettingsSection>
      ) : null}
      {passed.length > 0 ? (
        <FoldedSettingsSection
          id={id}
          title="Readiness details"
          summary={`${passed.length} ${passed.length === 1 ? "check" : "checks"} passed`}
        >
          {rows(passed)}
        </FoldedSettingsSection>
      ) : null}
    </>
  );
}
