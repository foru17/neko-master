---
name: ui-conventions
description: Frontend change conventions for apps/web — i18n (bilingual keys), dark mode (the highest-frequency rework source), theming inline SVG/chart colors, loading/empty/error states. Use for any UI change.
---

# UI Conventions (apps/web)

## i18n — every user-facing string, both locales

- Framework: `next-intl`, locales `zh` (default), `en`, and community-maintained `ru`. Message files: `apps/web/messages/{zh,en,ru}.json` — a key added to zh or en MUST be added to the other in the same commit; add it to `ru.json` when you can (missing ru keys fall back to English via `i18n/request.ts`).
- Components use `useTranslations('namespace')`. Never hardcode user-facing strings — including chart tooltips, `title` attributes, and aria-labels (historically the most-missed spots).
- Utility functions that produce display text (`formatDuration` style) must not embed English words; return structured data and translate in the component.

## Dark mode — check on every visual change

This is the project's highest-frequency rework source. Rules:

1. **Never a lone light class.** Every `bg-*-50/100`, `text-*-500/600`, `border-*-200` needs a `dark:` counterpart. Grep your diff for `bg-white|bg-.*-50|text-gray-` before committing.
2. **Prefer theme tokens** over palette classes where one exists: `bg-background`, `bg-popover`, `text-muted-foreground`, `border-border` (defined in `app/globals.css` for both themes).
3. **Inline SVG / chart colors can't use Tailwind** — define both palettes and switch on `resolvedTheme`:

```tsx
const { resolvedTheme } = useTheme(); // next-themes
const palette = resolvedTheme === "dark" ? DARK_COLORS : LIGHT_COLORS;
```

Precedents: `components/features/countries/world-traffic-map.tsx` (MAP_THEME), `components/features/rules/rule-chain-flow.tsx`. Recharts axis ticks should use `fill: "currentColor"` or CSS variables, not hex grays.

4. Badge/status color sets: copy an existing complete set (e.g. the health badge classes in `app/[locale]/dashboard/components/header/index.tsx`) rather than writing light-only classes.

## Three states, always

Every data view needs loading (skeleton), empty, and **error** states. Error must be visible and actionable (retry button) — `return null` on error is a known anti-pattern here (see the chain-flow retry card in `rule-chain-flow.tsx` for the reference implementation). Route-level failures are caught by `app/[locale]/error.tsx` / `app/global-error.tsx`; heavy visualizations should still fail locally, not blank the page.

## Data layer

- Server state via React Query; query keys are centralized in `lib/stats-query-keys.ts` — never inline ad-hoc keys.
- The stats WebSocket (`lib/websocket.ts`) tags pushes with `backendId` and the hook drops mismatched messages — preserve this when touching the message path (prevents cross-backend cache bleed on backend switch).
- Custom `memo` comparators must compare **every** prop the component renders from (a missed prop froze the Active Policy whitelist once — include new props in the comparator when you add them).

## Components

- shadcn/ui (`new-york`) + Tailwind v4 + lucide-react. Base primitives in `components/ui/` — reuse before creating; use the Radix `Dialog` for modals (no hand-rolled fixed overlays — they lose Esc/focus-trap behavior).
- Aesthetic bar: modern SaaS quality; avoid flat "admin panel" layouts. Search and other high-frequency entries should be prominent (icon inside input, clear affordances).
