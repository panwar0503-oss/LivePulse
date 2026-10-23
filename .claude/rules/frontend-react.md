---
paths:
  - "web/**/*.{ts,tsx}"
---

# Frontend (Next.js + React + Tailwind)

- Confirm the router in use (App Router `src/app/` proposed). Server Components by default; `"use client"` only
  for state, effects, browser APIs, or sockets.
- Typed props (`type XProps`), no `any`. Every data view handles loading, error, empty, and success states.
- Only `NEXT_PUBLIC_*` env vars reach the browser; treat them as public. Client checks are UX only.
- Socket logic lives in `src/realtime/` as typed hooks/providers; components never use raw sockets.
- Accessibility: semantic elements (no clickable `div`), labels on inputs, keyboard access with visible focus,
  polite `aria-live` for live results without announcing every tick, WCAG AA contrast, meaning not by colour alone.
- Tailwind utilities; extract a component for repeated patterns. Mobile-first.
