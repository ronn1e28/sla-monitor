# Frontend — SLA Monitor

React 19 + TypeScript + Vite. Hash-based routing (no server rewrite rules needed), dark mode only, styled with plain CSS custom properties.

## Stack

| | |
|---|---|
| Framework | React 19 + TypeScript |
| Bundler | Vite 8 |
| Routing | `react-router-dom` v7 (`HashRouter`) |
| Backend | Supabase JS client (`@supabase/supabase-js` v2) |
| Fonts | JetBrains Mono (stat numbers via Google Fonts) |

## Pages

- `#/` — Dashboard: collapsible service health cards + paginated check logs
- `#/upload` — Upload a CSV to the `process-upload` Edge Function

## Local setup

Copy `.env.example` to `.env` and fill in the values from *Supabase → Project Settings → API Keys*:

```
VITE_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

```bash
npm install
npm run dev
```

## Build

```bash
npm run build   # outputs to dist/
npm run preview # preview the production build locally
```

## Deploy (Vercel)

Set **Root Directory** to `frontend` in the Vercel project settings, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as environment variables (type *Config*), then deploy. Values are baked in at build time — redeploy after changing them.
