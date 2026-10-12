import {
  CircleAlertIcon,
  CloudOffIcon,
  FileWarningIcon,
  LogInIcon,
  ServerCrashIcon,
  UnplugIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";

import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/button";
import {
  lineParts,
  plainText,
  type KnowledgeErrorAction,
  type KnowledgeErrorSegment,
  type KnowledgeErrorView,
} from "./knowledgeError.logic";

const ICON: Readonly<Record<KnowledgeErrorView["kind"], LucideIcon>> = {
  unreachable: WifiOffIcon,
  refused: ServerCrashIcon,
  invalid: FileWarningIcon,
  failed: CircleAlertIcon,
  unsupported: CloudOffIcon,
  signedOut: LogInIcon,
  disconnected: UnplugIcon,
};

const VARIANT = { error: "error", warning: "warning", neutral: "default" } as const;

const LABEL: Readonly<Record<KnowledgeErrorAction, string>> = {
  retry: "Try again",
  copy: "Copy details",
  hub: "Workspace › Hub",
  signIn: "Sign in",
  reconnect: "Reconnect",
};

function Segments({ line }: { readonly line: ReadonlyArray<KnowledgeErrorSegment> }) {
  return lineParts(line).map(({ at, text, strong }) =>
    strong ? (
      <strong key={at} className="font-semibold text-foreground">
        {text}
      </strong>
    ) : (
      <Fragment key={at}>{text}</Fragment>
    ),
  );
}

/**
 * Why the list of Knowledge to keep is not there, in the kind of card its failure calls for: what
 * failed and where, what the person can do, and for a failure worth reporting, the details to read
 * or copy. A request that did not run or did not answer is never drawn as an empty list.
 */
export function KnowledgeErrorCard({
  view,
  retrying,
  copied,
  onAction,
}: {
  readonly view: KnowledgeErrorView;
  /** Asking again is under way. */
  readonly retrying: boolean;
  /** The details were just copied. */
  readonly copied: boolean;
  readonly onAction: (action: KnowledgeErrorAction) => void;
}) {
  const Icon = ICON[view.kind];
  return (
    <Alert
      variant={VARIANT[view.tone]}
      role={view.tone === "error" ? "alert" : "status"}
      controlAlignment="first-line"
    >
      <Icon aria-hidden />
      <AlertTitle>{view.title}</AlertTitle>
      <AlertDescription>
        {view.lines.map((line) => (
          <p key={plainText(line)}>
            <Segments line={line} />
          </p>
        ))}
        {view.actions.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {view.actions.map((action, index) => (
              <Button
                key={action}
                size="sm"
                variant={index === 0 ? "default" : "outline"}
                disabled={action === "retry" && retrying}
                onClick={() => onAction(action)}
              >
                {action === "retry" && retrying
                  ? "Trying again…"
                  : action === "copy" && copied
                    ? "Copied"
                    : LABEL[action]}
              </Button>
            ))}
          </div>
        )}
        {view.details.length === 0 ? null : (
          <details open className="rounded-lg border border-border bg-background/60 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-foreground">
              Details
            </summary>
            <dl className="mt-2 grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[8.5rem_minmax(0,1fr)]">
              {view.details.map(({ label, value, code }) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 text-foreground">
                    {code === true ? <code className="font-mono break-all">{value}</code> : value}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </AlertDescription>
    </Alert>
  );
}
