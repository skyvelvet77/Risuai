# 2026-03-18 RisuAI custom sync note for Cupcake Plugin Manager / GitHub Copilot / iPhone Safari / Docker

## 0. Why this document exists

This document records **exactly which RisuAI-side changes were needed** so that:

- the user can keep using **official `cupcake-plugin-manager` JavaScript**,
- the actual request path is **GitHub Copilot custom model + Anthropic format + `https://api.githubcopilot.com/v1/messages`**,
- iPhone Safari does **not** burn 2 requests for 1 prompt,
- Docker / node-hosted RisuAI can still **stream**,
- and later, when upstream RisuAI updates again, we can quickly verify whether these changes were already absorbed upstream or must be re-applied.

This file is intentionally verbose. It is meant to be a future migration checklist, not just a one-time memo.

---

## 1. Branch / baseline state at the time of this note

- Working repo: `skyvelvet77/Risuai`
- Upstream repo: `kwaroran/Risuai`
- Date of work: **2026-03-18 (Asia/Seoul)**
- Upstream `main` synced into local/fork `main` first, then merged into `custom`
- Upstream/fork `main` baseline commit at sync time: **`b8b4de1d`**
- First runtime bugfix commit already applied on `custom`: **`83daa8ef23ac09e89847784185796554ca5bdf12`**
  - message: `fix: restore node-hosted v3 plugin streaming bridge`

This document covers:

1. the already-committed runtime patch (`83daa8ef...`), and
2. the additional test/unhandled-error cleanup done afterward.

---

## 2. The user’s actual runtime path (important correction)

The important runtime path is **not** RisuAI built-in Anthropic request code.

The user’s real setup is:

- use **official Cupcake Plugin Manager**,
- use **Copilot custom model**,
- target base domain `api.githubcopilot.com`,
- use **Anthropic format**,
- which means CPM itself rewrites the request to **`/v1/messages`**.

So the critical question was not “does RisuAI’s built-in `anthropic.ts` support adaptive thinking?”

The real question was:

> Can the current RisuAI V3 plugin bridge + host/native fetch path correctly support the official CPM request flow for Copilot/Anthropic `/v1/messages`, especially on iPhone Safari and node-hosted Docker?

The answer is: **yes, but only after the Risu-side bridge/proxy fixes below.**

---

## 3. External evidence from the official `cupcake-plugin-manager` repository

Repository used as the primary reference:

- Repo: `https://github.com/ruyari-cupcake/cupcake-plugin-manager`
- README: `https://raw.githubusercontent.com/ruyari-cupcake/cupcake-plugin-manager/main/README.md`
- Main runtime file: `https://raw.githubusercontent.com/ruyari-cupcake/cupcake-plugin-manager/main/provider-manager.js`
- Copilot token/helper plugin: `https://raw.githubusercontent.com/ruyari-cupcake/cupcake-plugin-manager/main/cpm-copilot-manager.js`

### 3.1 Official CPM already rewrites Copilot + Anthropic to `/v1/messages`

In `provider-manager.js`:

- line ~`6475-6479`
- logic:
  - if URL contains `githubcopilot.com`
  - and format is `anthropic`
  - then `effectiveUrl = 'https://api.githubcopilot.com/v1/messages'`

Meaning:

- the official plugin itself already knows that **Copilot + Anthropic format must go to `/v1/messages`**.
- We do **not** need to patch RisuAI for that URL rewrite.
- If future CPM removes/changes this logic, re-check it first before touching Risu.

### 3.2 Official CPM already builds Anthropic-style thinking/adaptive-thinking payloads

In `provider-manager.js` around line ~`6311-6345`:

- for `format === 'anthropic'`
- `body.messages = formattedMessages`
- adaptive thinking path:
  - `body.thinking = { type: 'adaptive' }`
  - `body.output_config = { effort: ... }`
- budget thinking path:
  - `body.thinking = { type: 'enabled', budget_tokens: ... }`

Meaning:

- “AdoptThinking / AdaptiveThinking” behavior for this custom-model path is **owned by CPM**, not by RisuAI built-in Anthropic code.
- So for the user’s exact Copilot custom-model path, the main Risu requirement is **transport correctness** (native fetch + streaming bridge), not another provider-side payload patch.

### 3.3 Official CPM already adds the Anthropic header for Copilot/Anthropic requests

In `provider-manager.js`:

- line ~`6471`
- and again around `6481-6491`
- it sets:
  - `headers['anthropic-version'] = '2023-06-01'`

Meaning:

- the official CPM already knows this request needs Anthropic-style headers.
- RisuAI does **not** need another special-case provider rewrite for that.

### 3.4 Official CPM expects Copilot to use `nativeFetch` first

In `provider-manager.js` around line ~`3612-3655`:

- comment says Copilot must **not** skip `nativeFetch`
- comment explains Copilot API does not support CORS well enough for this path
- comment explains host-side/native fetch is the viable route

In `cpm-copilot-manager.js` around line ~`198-217`:

- comment explicitly says:
  - GitHub Copilot API does not support CORS for this use case
  - `nativeFetch` goes through the RisuAI proxy/server path
  - this is the intended strategy for hosted / Docker / web environments

Meaning:

- official CPM is designed around **RisuAI providing a working `nativeFetch` path**.
- if RisuAI’s node-hosted web path skips local `/proxy2`, CPM behavior degrades.

### 3.5 Official CPM expects Copilot to stream

In `provider-manager.js` around line ~`6496-6525`:

- comment says Copilot **must stream**
- `useStreaming` is computed so Copilot stream requests still try to stream
- Anthropic path sets `streamBody.stream = true`

Meaning:

- if RisuAI V3 bridge cannot pass stream bodies correctly, the official CPM flow breaks exactly in the way the user reported:
  - Safari weirdness,
  - fallback path confusion,
  - duplicate charge / duplicate request risk,
  - node-hosted Docker stream loss.

### 3.6 Role split: `provider-manager.js` vs `cpm-copilot-manager.js`

This is important for future debugging.

- `provider-manager.js`
  - owns the **actual custom model chat request path**
  - builds the request body
  - selects `/v1/messages`
  - attaches headers
  - controls streaming
  - chooses `nativeFetch` / fallback strategy

- `cpm-copilot-manager.js`
  - mainly owns **token setup / quota / helper API flows**
  - still useful as evidence because it also assumes `nativeFetch` first for Copilot API endpoints
  - but it is **not** the main file that builds the user’s custom-model chat request

So in future updates, if the user says “Copilot custom model chat broke”, check `provider-manager.js` first.

---

## 4. Root causes found on the RisuAI side

## 4.1 Root cause A — node-hosted `fetchNative()` skipped the local `/proxy2` path

### Problem

In `src/ts/globalApi.svelte.ts`, `fetchNative()` previously did this:

```ts
let throughProxy = (!isTauri) && (!isNodeServer) && (!db.usePlainFetch)
```

That meant:

- Tauri: no proxy (expected)
- normal browser-hosted cloud/web path: proxy (expected)
- **node-hosted web / Docker path: proxy disabled (unexpected for this CPM flow)**

For the user’s case, this was bad because official CPM expects `Risu.nativeFetch()` to be the reliable hosted path for Copilot.

### Why this mattered

When node-hosted web skipped the proxy path:

- hosted web behaved differently from expected host-side/native fetch behavior,
- Copilot stream path became unstable,
- Docker environment lost the “nativeFetch via local host/proxy” behavior CPM assumes,
- fallbacks could kick in differently,
- that creates the exact kind of environment where “streaming dies” and “duplicate replay / double charge” bugs show up.

### Fix

Changed logic to:

```ts
let throughProxy = (!isTauri) && (!db.usePlainFetch)
const proxyUrl = !isTauri && !isNodeServer ? hubURL + `/proxy2` : `/proxy2`
```

and then:

```ts
const r = await fetch(proxyUrl, { ... })
```

### Meaning of the fix

- web/cloud-hosted case still uses `hubURL + /proxy2`
- node-hosted/Docker web now uses **local `/proxy2`**
- Tauri remains separate
- `usePlainFetch` still keeps its intended override behavior

### Effect on the user’s real setup

This is the key reason Docker/node-hosted CPM Copilot requests can again use the intended hosted/native route.

---

## 4.2 Root cause B — V3 plugin guest bridge did not transfer stream objects

### Problem

In `src/ts/plugins/apiV3/factory.ts`, the guest-side transferable collector did **not** include:

- `ReadableStream`
- `WritableStream`
- `TransformStream`

So even if the host side produced a streaming `Response`, the bridge layer itself could fail to move the stream body across plugin boundaries correctly.

### Why this mattered

Official CPM for Copilot expects:

- stream-capable response handling,
- `nativeFetch` first,
- V3 plugin iframe → host bridge to survive stream transport.

If stream objects are not transferable at this boundary, the whole request may degrade into:

- Safari incompatibility behavior,
- forced non-streaming behavior,
- fallback confusion,
- duplicate retry/replay risk,
- user-visible “why is this charged twice?” symptoms.

### Fix

Added these to `collectTransferables()` in `src/ts/plugins/apiV3/factory.ts`:

```ts
obj instanceof ReadableStream ||
obj instanceof WritableStream ||
obj instanceof TransformStream
```

### Meaning of the fix

The V3 plugin guest can now hand back stream-capable bodies to the host side without silently dropping the streaming transport object class.

### Effect on the user’s real setup

This is the core Safari/V3 bridge fix for CPM’s Copilot streaming path.

---

## 4.3 Root cause C — tests had unrelated unhandled errors caused by side-effect imports

This problem was not the user’s runtime bug, but it mattered because it polluted verification.

### Symptom

Full test runs produced unhandled errors such as:

- missing mock exports from `database.svelte`
- `Cannot read properties of undefined (reading 'selId')`

### Root cause

`src/ts/process/files/inlays.ts` was importing heavy runtime modules at top level for `supportsInlayImage()`:

- `getDatabase`
- `getModelInfo`
- `LLMFlags`
- and a utility import

That made simple inlay tests pull in a much wider application graph than necessary.

That import chain eventually touched parser/store/reactive code paths, and partial Vitest mocks then caused unhandled Svelte effect errors.

### Why it mattered

The runtime Safari/Docker fix may be correct, but if test runs still produce unrelated unhandled errors, future maintenance becomes messy:

- hard to trust green/red signals,
- difficult to know whether a future upstream merge actually preserved the fix,
- easy to waste time debugging the wrong failure.

---

## 5. Exact RisuAI file changes

## 5.1 Runtime patch already committed in `83daa8ef23ac09e89847784185796554ca5bdf12`

### File: `src/ts/globalApi.svelte.ts`

#### Changed behavior

Before:

```ts
let throughProxy = (!isTauri) && (!isNodeServer) && (!db.usePlainFetch)
```

After:

```ts
let throughProxy = (!isTauri) && (!db.usePlainFetch)
const proxyUrl = !isTauri && !isNodeServer ? hubURL + `/proxy2` : `/proxy2`
```

and later:

```ts
const r = await fetch(proxyUrl, {
```

#### Impact

- fixes node-hosted/Docker web path for `nativeFetch`-style hosted requests
- restores local `/proxy2` use where CPM expects it
- directly relevant to Copilot custom-model traffic through official CPM

#### Future upstream verification rule

When rebasing onto a newer upstream RisuAI, check whether `src/ts/globalApi.svelte.ts` still contains all three of these patterns:

1. `let throughProxy = (!isTauri) && (!db.usePlainFetch)`
2. `const proxyUrl = !isTauri && !isNodeServer ? hubURL + \'/proxy2\' : \'/proxy2\'`
3. `fetch(proxyUrl, {`

If any of the above is missing, re-evaluate before assuming the fix is upstreamed.

### File: `src/ts/plugins/apiV3/factory.ts`

#### Changed behavior

Added stream object classes to transferable detection:

- `ReadableStream`
- `WritableStream`
- `TransformStream`

#### Impact

- lets V3 plugin bridge return streaming bodies safely
- directly relevant to CPM Copilot streaming on Safari / iframe environment

#### Future upstream verification rule

Check whether `collectTransferables()` still explicitly includes all three stream classes.

### File: `src/ts/plugins/apiV3/tests/nodeHostedPluginBridge.regression.test.ts`

#### Added regression guard

This test locks down both runtime assumptions:

1. stream transferables are present in the V3 bridge
2. node-hosted `fetchNative()` goes through local `/proxy2`

#### Impact

This is the fastest “did upstream absorb or remove our fix?” tripwire.

---

## 5.2 Additional cleanup patch for unhandled test errors

### File: `src/ts/process/files/inlays.ts`

#### What changed

Removed top-level responsibility for `supportsInlayImage()` from this file.

Also removed heavy imports from this module:

- `getDatabase`
- `getModelInfo`
- `LLMFlags`
- `asBuffer` import

Added a tiny local `asBuffer()` helper inside `inlays.ts` instead.

#### Why this matters

`inlays.ts` should mainly stay an inlay asset/data utility module.
It should not drag the whole model/runtime/parser graph into unit tests just because a test wants to store an inlay asset.

#### Runtime impact

No intended behavior change for inlay asset storage itself.
This is mostly dependency isolation.

### New file: `src/ts/process/files/inlaySupport.ts`

#### What it contains

This new file now owns:

```ts
export function supportsInlayImage() {
    const db = getDatabase()
    return getModelInfo(db.aiModel).flags.includes(LLMFlags.hasImageInput)
}
```

#### Why split it out

This isolates model/runtime-dependent logic into its own module.
That means:

- inlay asset tests can import `inlays.ts` without pulling in the full model graph,
- runtime callers that truly need model capability checks can still import a small dedicated helper.

### File: `src/ts/tokenizer.ts`

Changed import:

- before: `./process/files/inlays`
- after: `./process/files/inlaySupport`

### File: `src/ts/process/request/openAI/requests.ts`

Changed import:

- before: `../../files/inlays`
- after: `../../files/inlaySupport`

### Why the two import rewrites matter

These are the real runtime callers for `supportsInlayImage()`.
By moving them to `inlaySupport.ts`, we preserve behavior while keeping `inlays.ts` lightweight.

### File: `src/ts/parser/parser.svelte.ts`

#### What changed

Before:

```ts
const charId = selIdState.selId
const char = DBState.db.characters?.[charId]
```

After:

```ts
const charId = selIdState?.selId ?? -1
const char = DBState?.db?.characters?.[charId]
```

#### Why this matters

In incomplete test environments, store state can be partially mocked.
This makes the reactive effect defensive instead of throwing an unhandled error during unit tests.

#### Runtime impact

No intended change in normal app runtime where these stores are present.
This is defensive hardening.

### File: `src/ts/process/files/tests/inlays.test.ts`

#### What changed

Adjusted mocks so the test no longer explodes on unrelated app imports.
Key additions include mock values for:

- `appVer`
- `getDatabase()` return shape
- `getCurrentChat()`
- `getCurrentCharacter()`

#### Why this matters

The test now covers the inlay unit itself instead of crashing because unrelated runtime globals were partially missing.

### File: `src/ts/media/compressImage/tests/compressImage.test.ts`

#### What changed

Added mocked store state:

- `selIdState: { selId: 0 }`
- `selectedCharID: writable(0)`

#### Why this matters

This closes another gap in the lightweight test environment so reactive code does not crash while tests import dependent modules.

---

## 6. What these changes mean for the user’s exact CPM Copilot setup

## 6.1 `/v1/messages` support

The official CPM already handles this.

So for:

- `githubcopilot.com`
- custom model
- Anthropic format

CPM itself rewrites to:

- `https://api.githubcopilot.com/v1/messages`

No extra Risu provider patch was needed for the URL rewrite itself.

## 6.2 Adaptive thinking / reasoning / Opus 4.6 style use

For this custom-model path, the official CPM already handles Anthropic-style thinking payload construction:

- `body.thinking = { type: 'adaptive' }`
- `body.output_config = { effort: ... }`
- budget-based thinking support
- `anthropic-version` header

So the limiting factor was **transport**, not missing body fields in RisuAI built-in Anthropic code.

In practical terms:

- if the official CPM is current,
- and the model/provider path really supports those Anthropic-style fields behind Copilot,
- then the Risu-side fix needed was to **stop breaking native fetch / stream transport**.

That is exactly what the bridge/proxy patch addressed.

## 6.3 Why this is a better fix than continuing `cuplbi`-style provider workarounds inside Risu

The user’s stated goal is:

> “Use official cupcake-plugin-manager JS on a fresh/latest Risu, and have web + Safari both work with single-charge requests, reasoning, and streaming.”

That means the right architectural fix is:

- keep provider behavior in CPM,
- keep transport behavior correct in Risu.

This custom Risu patch follows that boundary.

---

## 7. Future upgrade / rebase checklist

When pulling a newer upstream RisuAI later, use this checklist.

## 7.1 Check whether the core runtime fix is already upstreamed

### Check 1 — stream transferables in V3 bridge

Search in `src/ts/plugins/apiV3/factory.ts` for all of:

- `obj instanceof ReadableStream`
- `obj instanceof WritableStream`
- `obj instanceof TransformStream`

If all three exist in `collectTransferables()`, this part may already be upstreamed.

### Check 2 — node-hosted local `/proxy2`

Search in `src/ts/globalApi.svelte.ts` for all of:

- `let throughProxy = (!isTauri) && (!db.usePlainFetch)`
- `const proxyUrl = !isTauri && !isNodeServer ? hubURL + \'/proxy2\' : \'/proxy2\'`
- `fetch(proxyUrl, {`

If not present, re-apply carefully.

### Check 3 — regression test

Check whether an equivalent regression test still exists for both:

- V3 stream transferables
- node-hosted `/proxy2`

If upstream removed the test, do **not** assume the behavior stayed correct.

## 7.2 Check whether the official CPM still expects the same behavior

Before modifying Risu again, inspect the latest official CPM repo for these exact behaviors:

### In `provider-manager.js`

- Copilot + Anthropic → `/v1/messages`
- Anthropic thinking/adaptive thinking body fields
- `anthropic-version` header for Copilot Anthropic path
- Copilot-specific `nativeFetch` first strategy
- Copilot streaming logic still enabled

### In `cpm-copilot-manager.js`

- Copilot API path still prefers `nativeFetch`
- comments/logic still assume Risu-side hosted/native transport

If CPM changes here, do **not** blindly reapply old Risu patches without re-reading the new CPM behavior.

---

## 8. Manual runtime verification checklist after future upgrades

After rebasing onto a newer upstream RisuAI and re-installing the official CPM JS:

1. Start latest custom image / container
2. Hard refresh iPhone Safari (preferably clear cache/tab)
3. Load official `cupcake-plugin-manager`
4. Configure Copilot custom model with Anthropic format
5. Send exactly one prompt
6. Verify actual upstream/provider-side request count is **1**
7. Verify response arrives as **streaming**, not one final blob
8. Verify cancel does not create a hidden replay
9. Repeat once in a fresh chat and once in an existing chat

Success criteria:

- one user send → one provider request
- no duplicate charge
- streaming visible in Docker/node-hosted setup
- Safari path does not force a broken fallback

---

## 9. Verification commands used for this work

These are the commands that should be run whenever this patch is touched again:

```bash
CI=1 corepack pnpm vitest run src/ts/process/files/tests/inlays.test.ts
corepack pnpm check
CI=1 corepack pnpm test -- --reporter=basic
NODE_OPTIONS=--max-old-space-size=4096 corepack pnpm build
```

Expected meaning:

- inlay unit test passes without unhandled errors
- type/svelte check passes
- full test suite passes cleanly
- production build succeeds

### 9.1 Verification results from this work session

These were re-run after the final patch set in this session:

- `CI=1 corepack pnpm vitest run src/ts/process/files/tests/inlays.test.ts`
  - result: **1 file passed / 23 tests passed / exit 0**
- `corepack pnpm check`
  - result: **`svelte-check found 0 errors and 0 warnings`**
- `CI=1 corepack pnpm test -- --reporter=basic`
  - result: **11 files passed / 119 tests passed / 4 skipped / exit 0**
- `NODE_OPTIONS=--max-old-space-size=4096 corepack pnpm build`
  - result: **build completed successfully / exit 0**
  - note: build still emits pre-existing Vite warnings (CSS `::highlight(...)`, large chunk warnings, dynamic import chunk warnings), but the build succeeds.

---

## 10. Final conclusion

For the user’s exact setup, the key fix was **not** “patch Anthropic provider logic inside RisuAI again”.

The key fix was:

1. make node-hosted `nativeFetch`/`fetchNative` route correctly through local `/proxy2`, and
2. make the V3 plugin bridge correctly transfer stream objects.

Everything else in this note exists to make that fix maintainable:

- regression protection,
- clean test runs,
- and a future rebase checklist.

If a future upstream Risu already contains the runtime patterns described above, this custom patch may no longer be necessary.
If not, this document shows exactly what to port and exactly why.
