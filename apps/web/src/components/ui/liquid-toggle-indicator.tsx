import { useLayoutEffect, useRef } from "react";

import { observeResize } from "~/lib/observeResize";

/** Follow the primitive's committed selection, including uncontrolled and keyboard changes. */
export function LiquidToggleIndicator() {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const indicator = ref.current;
    const group = indicator?.parentElement;
    if (!indicator || !group) return;

    const material = indicator.firstElementChild;
    const gleam = material?.firstElementChild;
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
      });
      group.dataset.liquidIndicator = "";
      selected = next;
      destination = geometry;

      if (!moving || !previous) return;
      const fromX = previous.left - bounds.left - group.clientLeft + group.scrollLeft;
      const fromY = previous.top - bounds.top - group.clientTop + group.scrollTop;
      animations.push(
        indicator.animate(
          [
            {
              transform: `translate(${fromX}px, ${fromY}px) scale(${previous.width / target.width}, ${previous.height / target.height})`,
            },
            { transform },
          ],
          { duration: 460, easing: "cubic-bezier(0.22, 1.12, 0.36, 1)" },
        ),
      );

      if (material) {
        const vertical = Math.abs(fromY - y) > Math.abs(fromX - x);
        animations.push(
          material.animate(
            [
              { transform: "scale(1)" },
              { transform: vertical ? "scale(0.94, 1.08)" : "scale(1.08, 0.94)", offset: 0.3 },
              { transform: "scale(1)" },
            ],
            { duration: 460, easing: "ease-out" },
          ),
        );
      }
      if (gleam) {
        animations.push(
          gleam.animate(
            [
              { transform: "translateX(-110%)", opacity: 0 },
              { opacity: 0.55, offset: 0.35 },
              { transform: "translateX(110%)", opacity: 0 },
            ],
            { duration: 460, easing: "ease-out" },
          ),
        );
      }
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
      <span className="liquid-selection absolute inset-0 overflow-hidden rounded-[inherit]">
        <span className="absolute inset-0 bg-linear-to-r from-transparent via-white/65 to-transparent opacity-0 dark:via-white/20" />
      </span>
    </span>
  );
}
