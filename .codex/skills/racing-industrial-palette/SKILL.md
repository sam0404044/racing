---
name: racing-industrial-palette
description: Project visual identity guide for a racing-industrial aesthetic built around Rust Red, Oil Black, Iron Gray, cyan, algorithm green, cool grays, flame neon orange, and bright red. Use when Codex designs or edits UI, CSS, HTML, game screens, visual assets, mockups, imagery prompts, Figma layouts, presentation slides, or any project-facing visuals for this racing project.
---

# Racing Industrial Palette

## Overview

Apply a harsh, mechanical racing tone: rusted metal, oil-dark surfaces, iron chassis, neon telemetry, warning lights, and heat. Keep the result functional and legible, with neon used as signal and acceleration rather than decoration.

## Palette

### Primary

- Rust Red: `#AA2704`
  Use for brand anchors, active states, heat marks, aggressive headings, key panels, and race-critical identity moments.
- Oil Black: `#3B3131`
  Use for main backgrounds, cockpit surfaces, overlays, navigation, and heavy UI foundations.
- Iron Gray: `#616569`
  Use for rails, dividers, disabled states, metal bodywork, secondary panels, and structural UI.

### Secondary

- High-Tech Cyan: prefer `#00D9FF`
  Use for telemetry, route guides, HUD outlines, scan lines, speed data, and interactive focus rings.
- Algorithm Green: prefer `#39FF88`
  Use for success states, AI/pathfinding indicators, system-ready states, and calculated racing feedback.
- Low-Brightness Cool Gray: prefer `#24282C`, `#343A40`, or `#8A9299`
  Use for quiet surfaces, subdued text, shadows, and background depth.

### Accent

- Flame Neon Orange: prefer `#FF5A00`
  Use for boost, countdowns, danger-adjacent energy, hover sparks, and speed streaks.
- Bright Red: prefer `#FF1E1E`
  Use sparingly for alerts, damage, failures, collision warnings, and urgent affordances.

## Usage Rules

- Start layouts from Oil Black and cool grays, then use Rust Red as the identity color.
- Reserve cyan and algorithm green for information systems: HUD, AI, telemetry, path, state, and interaction feedback.
- Use flame orange and bright red as short, high-energy bursts. Do not let them dominate entire screens.
- Preserve contrast for all UI text. Pair light text with Oil Black or dark cool gray; avoid placing small text directly on saturated red or orange.
- Favor hard-edged industrial shapes, thin technical lines, compact controls, and metal-like layers over soft playful styling.
- Avoid beige, cream, pastel, soft gradients, glossy luxury styling, and cute visual language.
- Avoid one-note red/black pages. Balance with Iron Gray, cool gray, cyan, and green so the interface feels like a racing machine with live systems.

## CSS Tokens

When adding or updating CSS, prefer these variables unless the project already has an equivalent token system:

```css
:root {
  --race-rust-red: #AA2704;
  --race-oil-black: #3B3131;
  --race-iron-gray: #616569;
  --race-cyan: #00D9FF;
  --race-algorithm-green: #39FF88;
  --race-cool-gray-900: #24282C;
  --race-cool-gray-800: #343A40;
  --race-cool-gray-500: #8A9299;
  --race-flame-orange: #FF5A00;
  --race-bright-red: #FF1E1E;
}
```

## Image And Prompt Guidance

For generated or edited raster visuals, describe the palette explicitly: rust red metal, oil-black chassis, iron-gray industrial surfaces, cyan telemetry light, algorithm-green system highlights, flame-orange boost glow, and bright-red warning flashes. Favor racing garages, machine parts, asphalt, heat, HUD overlays, speed, and mechanical wear.
