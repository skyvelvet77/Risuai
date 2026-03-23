# Repository Guidelines

## Project Structure & Critical Docs
This is the older customized full RisuAI fork, including web, Node-hosted, and Tauri paths. UI and logic live in `src/`, desktop code is in `src-tauri/`, hosting code is in `server/`, and assets/resources live in `public/` and `resources/`. If your change affects Cupcake Plugin Manager compatibility, Copilot transport, Safari/WebKit, or node-hosted proxy behavior, read `docs/2026-03-18-cupcake-copilot-risu-sync.md` first.

This repo is not the current user-facing deployment anymore; `Risuai-NodeOnly-custom` is the active path now. Treat this folder mostly as a reference, fallback, or migration source unless a task explicitly targets the older full Risu fork.

## Build, Test, and Development Commands
- `pnpm dev` starts the web dev server.
- `pnpm build` creates the standard build.
- `pnpm tauribuild` or `pnpm tauri build` builds the desktop app.
- `pnpm check` runs `svelte-check`.
- `pnpm test` runs Vitest.
- `pnpm runserver` starts the Node server.
- `pnpm hono:build` builds the Hono server bundle.
- `pnpm vitest run src/ts/plugins/apiV3/tests/nodeHostedPluginBridge.regression.test.ts` validates the node-hosted plugin bridge regression guard.

These commands are mainly for reference maintenance or migration checks now, not for the default day-to-day deployed app.

## Coding Style & Change Boundaries
Follow existing Svelte 5 + TypeScript conventions: camelCase filenames, `.svelte` for components, `.svelte.ts` for rune-based logic, and small focused changes around transport code. Preserve cross-platform behavior unless the change is intentionally Node-only or Safari-specific. Do not hand-edit `dist/`; modify source files and rebuild.

## Testing Guidelines
Run `pnpm check` plus the narrowest relevant Vitest scope before broader runs. If you touch `src/ts/globalApi.svelte.ts`, `src/ts/storage/nodeStorage.ts`, or `src/ts/plugins/apiV3/`, run the targeted bridge regression test and then `pnpm test`. For transport or Safari fixes, include a note about whether the change was validated against the documented Copilot/CPM flow.

## Commit & PR Guidelines
Recent history favors `fix:`, `test:`, `docs:`, and merge commits from upstream `main` into `custom`. Keep that style. PRs should state whether the change is upstream-compatible, custom-only, or a carry-forward patch tied to Safari/WebKit or node-hosted plugin bridging.
