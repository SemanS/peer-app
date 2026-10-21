# Peer brand assets

`peer/mark.svg` is the source of truth for the Peer symbol: an open lowercase p built from two rounded forms. Keep it flat and monochrome; use the surrounding interface's foreground color in UI and a light mark on the application icon.

Run `pnpm icons:export` from the repository root to regenerate the desktop, web, mobile, widget and current marketing icon assets. `pnpm icons:check` checks those outputs without changing files. `pnpm icons:export:android` regenerates only Android outputs. These commands use the existing Sharp dependency and do not require Icon Composer.

The exporter maintains the existing asset filenames for compatibility with release and packaging tools. Development, nightly and production use the same mark, with forest, slate and ink backgrounds respectively. Development assets are copied into `apps/web/public`; hosted release builds apply their channel's assets as before.

Icon Composer projects are generated too, for the iOS native build. Their flat mark and background match the PNGs. The macOS PNG keeps an 824 px body inset 100 px on its 1024 px canvas. iOS artwork is opaque and full bleed so the OS applies the mask. Android uses a transparent foreground within the adaptive-icon and splash safe zones, with a separate full-bleed background. The notification and widget marks are monochrome silhouettes.

Do not edit generated PNG, ICO, WebP, Icon Composer projects `peer/geometry.ts`, or `peer/icon-*.svg` files directly. Edit `peer/mark.svg` or the composition in `scripts/export-peer-icons.mjs`, then regenerate. The upstream Icon Composer export scripts remain for reference; Peer's package commands use the Peer exporter.
