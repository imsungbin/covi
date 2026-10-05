---
name: covi-visual-review
description: Review visual and UI changes by looking at them - before/after screenshots across viewports, pixel diffs, interaction states, responsive behavior, and accessibility - and report findings grounded in what the screens show. Use for CSS, layout, component, theming, and design changes.
---

# Visual review

Visual changes are judged by looking at them. Code review alone misses clipped text, broken alignment at one breakpoint, lost focus styles, and low contrast.

## Run it

1. Understand the change (`covi-understand`) and note which pages and components render the changed styles or markup.
2. Capture before/after at the viewports that matter, at least desktop and mobile for layout changes (`covi demo` with `"viewports": ["desktop", "mobile"]`; see `covi-demo`).
3. Open the before and after screenshots side by side, and the pixel diff in `demo/diffs/`. The diff shows where pixels changed; confirm each changed region is intended.
4. Exercise states with a flow when the change touches them: hover, focus (Tab through controls), disabled, error, empty, loading, long content.
5. Record findings in `findings.json` with the screenshot path and region as evidence, then `covi report`.

## What to look for

- **Intended change only.** Diff regions outside the intended area are unintended changes until proven otherwise.
- **Layout:** alignment, spacing rhythm, overflow and clipping, wrapping of long words and translations, sticky and fixed elements, scroll containers.
- **Responsive:** each breakpoint, not just the extremes; touch targets at least 44 px on mobile.
- **States:** hover, active, focus-visible, disabled, selected, error, empty, loading, and dark mode if the product supports it.
- **Accessibility:** contrast of text and essential icons (4.5:1 for body text, 3:1 for large text and UI components), visible focus indicators, keyboard reachability, text alternatives, labels, motion respecting reduced-motion settings.
- **Consistency:** design tokens (colors, radii, spacing, type scale) instead of one-off values; components reused rather than reimplemented.

## Evidence

A visual finding cites the screenshot (`demo/screenshots/<page>-<viewport>-after.png`) and the region ("the price column, top right"), and says what is wrong and why it matters. Covi's rules also flag removed focus outlines, images without alt text, and click handlers on non-interactive elements; confirm or dismiss them with what you see.

## Output files

Screenshots and diffs under `demo/`, findings in `findings.json`, rendered by `covi report`. A visual change is also a natural candidate for a short before/after video (`covi-video`, template `before-after`).
