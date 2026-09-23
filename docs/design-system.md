# BrewOps design system (to-be)

This is the canonical design spec for the BrewOps frontend: a "warm coffee-house"
theme. It was extracted from the working `:root` tokens in
`src/brewops/frontend/style.css` and is the target every frontend change should
match. When the CSS changes these tokens deliberately, update this file in the
same change so it stays the source of truth.

## Color

All color must come from a custom property below. No hex/rgb/hsl literal
should appear anywhere outside this `:root` block (gradients built *from*
these tokens, e.g. `linear-gradient(var(--brass), var(--crema))`, are fine —
a bare new hex value is not).

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f1e9dc` | Page background base |
| `--paper-deep` | `#e9decb` | Recessed surfaces (track backgrounds) |
| `--panel` | `#fbf7f0` | Card/panel surface |
| `--ink` | `#2a1c12` | Primary text |
| `--ink-soft` | `#7a6552` | Secondary/muted text |
| `--line` | `#e4d8c4` | Hairline borders |
| `--brass` | `#b9812f` | Primary accent (the one bold hue) |
| `--brass-deep` | `#8a5a1c` | Accent, darker (hover/emphasis, dark-surface text) |
| `--crema` | `#d9b382` | Accent, lighter (highlights, fills) |
| `--roast` | `#43301f` | Deep espresso surfaces (header, featured tile) |
| `--ok` / `--ok-bg` | `#3f7a3a` / `#e7efe2` | Success state only |
| `--warn` / `--warn-bg` | `#a3311f` / `#f6e6e0` | Warning/error state only |

Rule of thumb: exactly one bold accent hue (brass/crema) plus warm neutrals.
`--ok`/`--warn` exist only for state (success/error), never as decoration.

## Radius

| Token | Value | Use |
|---|---|---|
| `--radius` | `14px` | Panels, tiles, banners |
| `--radius-sm` | `9px` | Cards, inputs, buttons, badges |

Pills/tracks (`.bar-track`, `.badge`) use `border-radius: 999px` (fully
rounded) — that's the one allowed exception, not a third scale step. No other
literal radius value should appear.

## Shadow ("fades")

| Token | Value | Use |
|---|---|---|
| `--shadow` | `0 1px 2px rgb(42 28 18 / 0.05), 0 8px 24px rgb(42 28 18 / 0.07)` | Resting elevation (panels, tiles, cards) |
| `--shadow-lift` | `0 3px 6px rgb(42 28 18 / 0.09), 0 16px 36px rgb(42 28 18 / 0.14)` | Hover/active elevation |

Shadows are always warm-tinted (`rgb(42 28 18 / …)`, i.e. `--ink`), never
neutral black. No ad-hoc `box-shadow` values outside these two tokens.

## Typography

| Token | Stack | Use |
|---|---|---|
| `--serif` | `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, "Times New Roman", serif` | Headings, numbers/KPIs, the leader name — anything that should feel "signage" |
| `--sans` | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Body text, labels, buttons, form UI |

No web fonts are loaded — both stacks are system fonts only. Section
eyebrows (`.panel h2`, `.tile-label`, `.badge`) are small-caps style: sans,
bold, uppercase, `letter-spacing` around `0.07em`–`0.14em`.

## Interaction states

Anything interactive (buttons, cards, tiles, inputs, the timeline bars)
should have:
- A `:hover` state — typically `transform: translateY(-3px)` +
  `box-shadow: var(--shadow-lift)` for lift-able surfaces, or a color/fill
  swap (e.g. `.timeline-bar:hover`) for flat marks.
- Inputs/buttons use `:focus-visible` with a brass-tinted outline/ring
  (`rgb(185 129 47 / …)`), not the browser default.
- Transitions are short (`0.1s`–`0.16s`) `ease` or a cubic-bezier for bars.
- All motion is wrapped by the global
  `@media (prefers-reduced-motion: reduce)` kill switch — new
  animations/transitions must be covered by it (they are, automatically,
  since it targets `*`).

## Layout

- `main` and the dashboard grid live inside a `1080px` max-width, centered.
- Panels are the base unit: `border: 1px solid var(--line)`, `var(--radius)`,
  `var(--shadow)`, `var(--panel)` background.
- Spacing is `rem`-based; no bare pixel padding/margins outside icon-sized
  details (borders, small offsets under ~4px).
