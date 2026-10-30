"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const toggleVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base text-foreground outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:opacity-64 data-pressed:text-accent-foreground sm:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    compoundVariants: [
      // A liquid switch set by its own padding and type, so a narrow one such as the sidebar's
      // fits its labels. The base's `sm:text-sm` would otherwise win from `sm` up.
      { class: "px-1.5 text-xs sm:text-xs", size: "compact", variant: "liquid" },
    ],
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        compact:
          "h-7 min-w-7 rounded-md px-[calc(--spacing(1)-1px)] text-xs before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-9 min-w-9 px-[calc(--spacing(2)-1px)] sm:h-8 sm:min-w-8",
        lg: "h-10 min-w-10 px-[calc(--spacing(2.5)-1px)] sm:h-9 sm:min-w-9",
        segmented:
          "h-6 min-w-0 rounded-md px-2.5 text-xs before:rounded-[calc(var(--radius-md)-1px)]",
        sm: "h-8 min-w-8 px-[calc(--spacing(1.5)-1px)] sm:h-7 sm:min-w-7",
        xs: "h-7 min-w-7 px-[calc(--spacing(1)-1px)] sm:h-6 sm:min-w-6 rounded-md",
      },
      variant: {
        default: "border-transparent data-pressed:bg-input/64",
        liquid:
          "rounded-full border-transparent px-3 text-sm text-foreground/75 shadow-none before:rounded-full hover:bg-foreground/5 hover:text-foreground data-pressed:liquid-selection data-pressed:text-foreground group-data-[liquid-indicator]/liquid:data-pressed:bg-transparent group-data-[liquid-indicator]/liquid:data-pressed:shadow-none",
        navigation:
          "h-11 rounded-none border-0 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground before:hidden hover:bg-transparent hover:text-foreground data-pressed:border-foreground data-pressed:bg-transparent data-pressed:text-foreground sm:h-11",
        pill: "data-pressed:bg-input/64 border-transparent rounded-full px-3 font-normal text-muted-foreground data-pressed:text-foreground",
        ghost:
          "border-transparent text-foreground shadow-none [:disabled,:active,[data-pressed]]:shadow-none before:shadow-none data-pressed:bg-accent data-pressed:text-accent-foreground disabled:opacity-100 disabled:text-muted-foreground disabled:[&_svg]:opacity-100",
        outline:
          "data-pressed:bg-input/64 border-input bg-background not-dark:bg-clip-padding shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:data-pressed:bg-input dark:hover:bg-input/64 dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] dark:not-disabled:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/2%)] [:disabled,:active,[data-pressed]]:shadow-none",
        // Unpressed options are foreground at 72%: muted grey on the group's `bg-input/40` fill fell
        // to 4.0-4.2:1 in several themes, under 4.5:1 for text.
        segmented:
          "border-transparent text-foreground/72 shadow-none transition-colors before:shadow-none hover:bg-background/55 hover:text-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-xs/10 dark:hover:bg-input/32 dark:data-pressed:bg-input/72",
      },
    },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      className={cn(
        toggleVariants({ size, variant }),
        "group-data-[liquid-indicator]/liquid:data-pressed:bg-transparent! group-data-[liquid-indicator]/liquid:data-pressed:shadow-none! group-data-[liquid-indicator]/liquid:data-pressed:border-transparent!",
        className,
      )}
      data-slot="toggle"
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
