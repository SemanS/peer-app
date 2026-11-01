import * as Schema from "effect/Schema";
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { useResizableWidth } from "../../../hooks/useResizableWidth";
import { cn } from "../../../lib/utils";
import { observeResize } from "../../../lib/observeResize";
import { RightPanelResizeHandle } from "../../preview/RightPanelResizeHandle";
import { Button } from "../../ui/button";
import { ProjectMark } from "../signals";

export function RoomSidePanel({
  storageKey,
  label,
  mobileShown,
  collapsed,
  onCollapse,
  children,
}: {
  readonly storageKey: string;
  readonly label: string;
  readonly mobileShown: boolean;
  readonly collapsed: boolean;
  readonly onCollapse: (collapsed: boolean) => void;
  readonly children: ReactNode;
}) {
  const desktop = useMediaQuery("lg");
  const host = useRef<HTMLElement>(null);
  const [available, setAvailable] = useState(() =>
    typeof window === "undefined" ? 960 : window.innerWidth,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ResizeObserver keeps the drag bounds inside the space left by the main sidebar.
  useEffect(() => {
    const parent = host.current?.parentElement;
    if (parent === undefined || parent === null) return;
    return observeResize(parent, () => setAvailable(parent.clientWidth));
  }, []);
  const max = Math.max(280, available - 280);
  const resize = useResizableWidth({
    storageKey,
    defaultWidth: Math.min(720, available * 0.6),
    minWidth: 280,
    maxWidth: max,
    edge: "left",
  });
  return (
    <section
      ref={host}
      aria-label={label}
      className={cn(
        "relative min-h-0 min-w-0 flex-1 flex-col lg:flex lg:flex-none lg:border-s lg:border-border",
        mobileShown ? "flex" : "hidden",
      )}
      style={
        {
          "--resizable-width": `${resize.width}px`,
          width: desktop ? (collapsed ? 40 : "var(--resizable-width)") : undefined,
        } as CSSProperties
      }
    >
      <div
        className={cn("min-h-0 min-w-0 flex-1 flex-col", desktop && collapsed ? "hidden" : "flex")}
      >
        {children}
      </div>
      <div className="absolute end-1 top-2 hidden lg:block">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={collapsed ? "Expand side panel" : "Collapse side panel"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand side panel" : "Collapse side panel"}
          onClick={() => onCollapse(!collapsed)}
        >
          {collapsed ? <PanelRightOpenIcon aria-hidden /> : <PanelRightCloseIcon aria-hidden />}
        </Button>
      </div>
      {!desktop || collapsed ? null : (
        <RightPanelResizeHandle
          handlers={resize.handlers}
          label="Resize conversation and side panel"
          tabIndex={0}
          aria-valuemin={280}
          aria-valuemax={Math.round(max)}
          aria-valuenow={Math.round(resize.width)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            resize.setWidth(resize.width + (event.key === "ArrowLeft" ? 24 : -24));
          }}
        />
      )}
    </section>
  );
}

export function RoomProjectColumn({
  name,
  colorKey,
  storageKey,
  shown,
  onDrag,
  children,
}: {
  readonly name: string;
  readonly colorKey: string;
  readonly storageKey: string;
  readonly shown: boolean;
  readonly onDrag: () => void;
  readonly children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useLocalStorage(
    `${storageKey}.collapsed`,
    false,
    Schema.Boolean,
  );
  const resize = useResizableWidth({
    storageKey,
    defaultWidth: 384,
    minWidth: 240,
    maxWidth: 1600,
    edge: "right",
  });
  return (
    <section
      aria-label={name}
      className={cn(
        "relative min-h-0 shrink-0 flex-col border-e border-border",
        shown ? "flex" : "hidden",
      )}
      style={
        {
          "--resizable-width": `${resize.width}px`,
          width: collapsed ? 40 : "var(--resizable-width)",
        } as CSSProperties
      }
      onDragStartCapture={onDrag}
    >
      <div
        className={cn(
          "shrink-0 items-center gap-2 border-b border-border/60 px-2 py-2",
          collapsed ? "flex flex-col" : "flex",
        )}
      >
        <ProjectMark name={name} colorKey={colorKey} className="size-4" />
        {collapsed ? null : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</h2>
        )}
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${name} panel`}
          aria-expanded={!collapsed}
          title={`${collapsed ? "Expand" : "Collapse"} ${name}`}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpenIcon aria-hidden /> : <PanelLeftCloseIcon aria-hidden />}
        </Button>
      </div>
      {collapsed ? (
        <span className="self-center py-2 text-xs text-muted-foreground [writing-mode:vertical-rl]">
          {name}
        </span>
      ) : null}
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", collapsed ? "hidden" : "flex")}>
        {children}
      </div>
      {collapsed ? null : (
        <RightPanelResizeHandle
          className="left-auto -right-1"
          handlers={resize.handlers}
          label={`Resize ${name} panel`}
          tabIndex={0}
          aria-valuemin={240}
          aria-valuemax={1600}
          aria-valuenow={Math.round(resize.width)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            resize.setWidth(resize.width + (event.key === "ArrowLeft" ? -24 : 24));
          }}
        />
      )}
    </section>
  );
}
