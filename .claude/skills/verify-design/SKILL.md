---
name: verify frontend design
description: Check the BrewOps frontend (HTML/CSS) against docs/design-system.md, the "to-be" design spec — flags colors, radius, shadows, or fonts that drift off the token system. Use when the user asks to check, verify, or audit the design/styling/UI consistency, or after a frontend change when they want a design review before calling it done.
---

## Why this exists

BrewOps's frontend is a small, deliberate token system (colors, radius,
shadow, fonts) defined once in `src/brewops/frontend/style.css`'s `:root`
and documented as the canonical spec in `docs/design-system.md`. Drift
happens quietly: someone pastes a one-off hex color, a `border-radius: 8px`
that's close-but-not-quite `--radius-sm`, or a plain black shadow. None of
that breaks tests, so nothing catches it except a design read. This skill is
that read.

## Steps

1. Read `docs/design-system.md` — that's the "to-be" spec, not this file.
   If it doesn't exist, say so and stop; don't invent a spec on the fly.
2. Read the current frontend source: `src/brewops/frontend/style.css`,
   `index.html`, and `app.js` (styles are sometimes set inline or via
   classList in JS, not just in the CSS file).
3. Check each dimension below. For every violation, note the file, line,
   the offending value, and which token it should be instead.

   **Color** — any hex/`rgb()`/`hsl()`/named color literal outside the
   `:root` block itself. Gradients *composed from* existing `var(--x)`
   tokens are fine; a new literal color (even a very close shade of brass)
   is not. Pay attention to inline `style="..."` in HTML/JS too.

   **Radius** — any `border-radius` that isn't `var(--radius)`,
   `var(--radius-sm)`, or the `999px` pill exception (used only for
   tracks/badges, not panels or cards).

   **Shadow** — any `box-shadow` that isn't `var(--shadow)` or
   `var(--shadow-lift)`, or that uses a neutral/black tint instead of the
   warm `rgb(42 28 18 / …)` (`--ink`) tint the spec calls for.

   **Fonts** — headings/numbers not using `var(--serif)`; body/UI/labels
   not using `var(--sans)`; any third font-family introduced.

   **Interaction states** — interactive elements (buttons, cards, tiles,
   inputs, clickable chart marks) missing a `:hover` and, for
   inputs/buttons, a `:focus-visible` state. Check that new
   transitions/animations are covered by the `prefers-reduced-motion`
   block (true automatically only if they're not scoped to bypass `*`).

   **Layout** — spacing not on the `rem` scale, or panels not built from
   the standard panel recipe (`border: 1px solid var(--line)`, `var(--radius)`,
   `var(--shadow)`, `var(--panel)` background) without a stated reason.

4. Report findings as a flat list, most-visible-to-a-user first. For each:
   `file:line — what's there → what it should be`. If nothing is off,
   say so plainly rather than padding the report with non-issues.
5. Don't auto-fix. This skill reports; let the user decide whether a
   flagged deviation is a mistake or an intentional exception (and if it's
   intentional and durable, point out that `docs/design-system.md` should be
   updated to reflect it).

## Gotchas

- A value that *matches* a token's rendered output but isn't written as the
  `var(...)` (e.g. a literal `#b9812f` instead of `var(--brass)`) still
  counts as a violation — the point is maintainability, not just the
  rendered pixels.
- `--ok`/`--warn` are state colors, not decoration — flag them if used
  outside an actual success/error context.
- Don't flag the `:root` block itself, and don't flag values inside
  `docs/design-system.md` — the spec is the reference, not the target.
- If `docs/design-system.md` and `style.css`'s `:root` have diverged (spec
  says one hex, CSS has another), flag that mismatch explicitly and ask
  which one is correct — don't silently pick a side.

## Version

0.1.0
