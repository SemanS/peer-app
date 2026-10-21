import type { ReactNode } from "react";

export function WorkspacePageIntro({
  title,
  description,
  leading,
  meta,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly leading?: ReactNode;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {leading}
          <h1 className="min-w-0 text-page-title font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
            {title}
          </h1>
          {meta}
        </div>
        {description === undefined ? null : (
          <div className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions}
    </header>
  );
}
