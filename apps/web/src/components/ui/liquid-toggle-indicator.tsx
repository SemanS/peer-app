import { useLayoutEffect, useRef } from "react";

import { observeResize } from "~/lib/observeResize";
import { LiquidGlassMaterial } from "./liquid-glass-material";

/** Follow the primitive's committed selection, including uncontrolled and keyboard changes. */
export function LiquidToggleIndicator() {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const indicator = ref.current;
    const group = indicator?.parentElement;
    if (!indicator || !group) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce), (forced-colors: active)",
    );
    let selected: HTMLElement | undefined;
    let destination = "";
    let animations: Animation[] = [];

    const stop = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
    };

    const update = () => {
      const pressed = [
        ...group.querySelectorAll<HTMLElement>("[data-slot=toggle][data-pressed]"),
      ].filter((item) => item.closest("[data-slot=toggle-group]") === group);
      const next = pressed.length === 1 ? pressed[0] : undefined;
      if (!next || !next.offsetWidth || !next.offsetHeight) {
        stop();
        selected = undefined;
        destination = "";
        indicator.style.visibility = "hidden";
        delete group.dataset.liquidIndicator;
        return;
      }

      const bounds = group.getBoundingClientRect();
      const target = next.getBoundingClientRect();
      const x = target.left - bounds.left - group.clientLeft + group.scrollLeft;
      const y = target.top - bounds.top - group.clientTop + group.scrollTop;
      const geometry = `${x},${y},${target.width},${target.height}`;
      if (selected === next && destination === geometry) return;

      // Capture the in-flight position before retargeting a rapid second switch.
      const previous = selected ? indicator.getBoundingClientRect() : null;
      const moving = selected !== undefined && selected !== next && !reducedMotion.matches;
      stop();
      const transform = `translate(${x}px, ${y}px)`;
      Object.assign(indicator.style, {
        visibility: "visible",
        width: `${target.width}px`,
        height: `${target.height}px`,
        transform,
        borderRadius: `${Math.max(8, Number.parseFloat(getComputedStyle(next).borderTopLeftRadius))}px`,
      });
      group.dataset.liquidIndicator = "";
      selected = next;
      destination = geometry;

      if (!moving || !previous) return;
      const fromX = previous.left - bounds.left - group.clientLeft + group.scrollLeft;
      const fromY = previous.top - bounds.top - group.clientTop + group.scrollTop;
      const vertical = Math.abs(fromY - y) > Math.abs(fromX - x);
      const stretch = Math.min(0.22, Math.hypot(x - fromX, y - fromY) / 500);
      const shape = (progress: number, along: number, across: number) => {
        const width = previous.width + (target.width - previous.width) * progress;
        const height = previous.height + (target.height - previous.height) * progress;
        return `translate(${fromX + (x - fromX) * progress}px, ${fromY + (y - fromY) * progress}px) scale(${(width / target.width) * (vertical ? across : along)}, ${(height / target.height) * (vertical ? along : across)})`;
      };
      animations.push(
        indicator.animate(
          [
            {
              transform: shape(0, 1, 1),
            },
            { transform: shape(0.48, 1 + stretch, 1 - stretch / 2), offset: 0.38 },
            { transform: shape(0.92, 1.03, 0.99), offset: 0.72 },
            { transform },
          ],
          { duration: 520, easing: "cubic-bezier(0.22, 0.75, 0.25, 1)" },
        ),
      );
    };

    let stopObservingSizes = () => {};
    const observeSizes = () => {
      stopObservingSizes();
      stopObservingSizes = observeResize(
        [group, ...group.querySelectorAll("[data-slot=toggle]")],
        update,
      );
    };
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) observeSizes();
      update();
    });
    mutations.observe(group, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-pressed", "dir", "data-orientation"],
    });
    reducedMotion.addEventListener("change", stop);
    observeSizes();
    update();
    return () => {
      stopObservingSizes();
      mutations.disconnect();
      reducedMotion.removeEventListener("change", stop);
      stop();
      delete group.dataset.liquidIndicator;
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="liquid-indicator"
      className="pointer-events-none invisible absolute top-0 left-0 origin-top-left rounded-full"
    >
      <LiquidGlassMaterial />
    </span>
  );
}
