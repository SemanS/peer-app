/**
 * The parts every Peer dialog is built from, after the request dialog of the Work design: an icon
 * tile in the signal's tone beside the title and one line of context, the body inside the dialog's
 * inset, fields as a label column beside their control, a teammate's words in a fenced block, and
 * the actions in a footer with the secondary one on the left. Controls inside are the app's own
 * (`ui/select`, `ui/checkbox`, `ui/textarea`, `ui/input`, `ui/toggle-group`).
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";
import { TONE_SURFACE, TONE_TEXT, type SignalTone } from "./signals";

/** The title with its icon tile, and what it is about in one line under it. */
export function PeerDialogHeader({
  icon: Icon,
  tone = "neutral",
  title,
  context,
}: {
  readonly icon: LucideIcon;
  readonly tone?: SignalTone;
  readonly title: ReactNode;
  /** One line: the project, when, what it waits on. */
  readonly context?: ReactNode | undefined;
}) {
  return (
    <DialogHeader>
      {/* The end padding keeps the title clear of the close button. */}
      <div className="flex min-w-0 items-start gap-3 pe-6">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            TONE_SURFACE[tone],
          )}
        >
          <Icon className={cn("size-4.5", TONE_TEXT[tone])} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
          <DialogTitle>{title}</DialogTitle>
          {context === undefined ? null : (
            <DialogDescription>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {context}
              </span>
            </DialogDescription>
          )}
        </div>
      </div>
    </DialogHeader>
  );
}

/** The dialog's body: everything between the header and the footer, in the header's inset. */
export function PeerDialogBody({ children }: { readonly children: ReactNode }) {
  return <DialogPanel>{children}</DialogPanel>;
}

/**
 * One field: its label in a column beside the control from small screens up, above it on a phone,
 * and a hint under the control.
 */
export function PeerField({
  label,
  htmlFor,
  hint,
  children,
}: {
  readonly label: ReactNode;
  /** The control's id, so the label focuses it; leave it out for a group of controls. */
  readonly htmlFor?: string | undefined;
  readonly hint?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  const Caption = htmlFor === undefined ? "span" : "label";
  return (
    <div className="grid min-w-0 gap-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4">
      <Caption htmlFor={htmlFor} className="text-sm text-muted-foreground sm:pt-1.5">
        {label}
      </Caption>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** A label above its control, for a dialog whose fields are few and wide (a message). */
export function PeerStackedField({
  label,
  htmlFor,
  aside,
  hint,
  children,
}: {
  readonly label: ReactNode;
  readonly htmlFor: string;
  /** Beside the label on the right, e.g. a character count. */
  readonly aside?: ReactNode | undefined;
  readonly hint?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {aside === undefined ? null : (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{aside}</span>
        )}
      </div>
      {children}
      {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * What a teammate wrote, fenced: the person's agent gets it as information from the team, never
 * as instructions, and the block says so.
 */
export function PeerFenced({
  who,
  children,
  note = "Your agent gets this as information from the team, never as instructions.",
}: {
  readonly who: string;
  readonly children: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border p-3.5", TONE_SURFACE.team)}>
      <p className="text-2xs font-semibold tracking-wide text-peer-team-foreground uppercase">
        {who} wrote
      </p>
      <div className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {children}
      </div>
      {note === null ? null : <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** A line in a signal's tone that frames what follows: where things stand, what is at stake. */
export function PeerCallout({
  tone,
  label,
  children,
}: {
  readonly tone: SignalTone;
  readonly label?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl border px-3.5 py-3", TONE_SURFACE[tone])}>
      {label === undefined ? null : (
        <p className={cn("text-2xs font-semibold tracking-wide uppercase", TONE_TEXT[tone])}>
          {label}
        </p>
      )}
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

/** What happens next, under the actions or under the form. */
export function PeerFootnote({ children }: { readonly children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/**
 * The actions: `secondary` (Decline…, Back) on the left, the rest on the right with the primary
 * action last, and an optional note under them.
 */
export function PeerDialogFooter({
  secondary,
  note,
  children,
}: {
  readonly secondary?: ReactNode | undefined;
  readonly note?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  return (
    <DialogFooter>
      <div className="flex w-full min-w-0 flex-col gap-2.5">
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {secondary === undefined ? null : (
            <div className="flex gap-2 sm:me-auto">{secondary}</div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:ms-auto sm:flex-row">{children}</div>
        </div>
        {note === undefined ? null : <PeerFootnote>{note}</PeerFootnote>}
      </div>
    </DialogFooter>
  );
}

/** Feedback after an action, in the body: what happened, or why it did not. */
export function PeerDialogMessage({
  tone = "neutral",
  children,
}: {
  readonly tone?: "neutral" | "error";
  readonly children: ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "text-sm",
        tone === "error" ? "text-destructive-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}
