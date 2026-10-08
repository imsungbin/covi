# Task 2 report: Core — URL-aware redaction

**Status:** DONE_WITH_CONCERNS
**Commit:** `3731478` Mask credential-shaped URL parameters in redaction (default identity, `Claude-Session:` trailer only)

## Implemented

Exactly the brief, verbatim:

- `packages/core/src/security/redact.ts`
  - After `URL_CREDENTIALS`: `SECRET_PARAM`, `URL_IN_TEXT`, `decodeName`, `maskPairs`, `maskSecretParams` (module-private).
  - In `class Redactor`, after `redact`: `redactUrl(url)` and `redactUrls(text)`.
  - Biome's only change: it put the `maskPairs` ternary on one line (fits in 100 columns).
- `packages/core/test/redact.test.ts`: appended the `describe('URL redaction', …)` block from the brief (3 tests).

## TDD evidence

RED: `npx vitest run packages/core/test/redact.test.ts`
```
 FAIL  packages/core/test/redact.test.ts > URL redaction > masks credential-shaped query and fragment parameters, keeping their names
TypeError: r.redactUrl is not a function
 FAIL  packages/core/test/redact.test.ts > URL redaction > leaves ordinary URLs alone
TypeError: r.redactUrl is not a function
 FAIL  packages/core/test/redact.test.ts > URL redaction > masks URLs inside text
TypeError: r.redactUrls is not a function
      Tests  3 failed | 7 passed (10)
```

GREEN: `npx vitest run packages/core/test/redact.test.ts`
```
 ✓ packages/core/test/redact.test.ts (10 tests) 5ms
      Tests  10 passed (10)
```

Verification:
- `npx vitest run packages/core`: 15 files, 156 tests passed.
- `npm run typecheck`: exit 0.
- `npx biome check --write <2 files>` (fixed 1 file, formatting only), then `npx biome check packages/core`: no fixes; `npm run lint` (`biome check .`): 270 files, no fixes, exit 0.

## Files

- `packages/core/src/security/redact.ts` (+54)
- `packages/core/test/redact.test.ts` (+42)

## Self-review

- Completeness: both methods, the two regexes, and the helpers match the brief. The tests are the brief's tests, unchanged.
- Architecture: core only, no new imports, no enums, comments explain why.
- Interface matches the Task 4 consumer: `redactUrl(local)` for request URLs, `redactUrls(text)` for console text (task-4-brief.md lines 380–381, 435).

## Concerns (probed with scratch scripts; nothing changed beyond the brief)

Probe scripts: `scratchpad/probe/redact-probe.ts`, `redact-baseline.ts`, `regex-candidates.ts`.

1. **Quadratic `URL_IN_TEXT` on hostile console text (new DoS risk).** Task 4 runs `redactUrls` on console text from the app under review, an untrusted source, *before* truncating it to `TRACE_LIMITS.text`. It has to: truncating first could split a secret. So the input length has no bound. Measured on `redactUrls`:
   - `'/-'.repeat(n)`: 80k chars → 1989 ms, 160k → 7905 ms. The baseline `redact()` takes 0–1 ms on the same input, so the path branch causes this.
   - `'a.'.repeat(n)`: 80k → 1620 ms, 160k → 6206 ms. `redact()` alone is already 1636 ms at 80k, because the existing `URL_CREDENTIALS` has the same `\b[a-z][a-z0-9+.-]*:\/\/` prefix. That part was already there; `redactUrls` roughly doubles it.
   - At 1 MB, one console message would take minutes. Task 4 stops early once `messages.length >= TRACE_LIMITS.console`, so at most 200 messages are redacted, but each can be any length.

   A linear candidate, tested in scratch:
   ```ts
   const URL_IN_TEXT =
     /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+|(?<![^\s"'<>`])\/[^\s"'<>`?#]*[?#][^\s"'<>`]+/gi;
   ```
   Same inputs: 0–3 ms at 240k chars. It still passes the brief's two `redactUrls` cases. The trade-off: a path must now start a whitespace- or quote-delimited token, so `url=/b?token=y` is no longer matched (the original matched it). The same `(?<![a-z0-9+.-])` lookbehind would also fix the existing `URL_CREDENTIALS` quadratic. The alternative is to cap the text length before redaction, which has the split-secret problem. The lead decides.

2. **camelCase parameter names are not masked (leak gap).** `?authToken=…&sessionToken=…&csrfToken=…&privateKey=…` pass through unchanged, because the prefix needs a `_`/`-` separator. Only listed camelCase forms (`accessToken`, `apiKey`, `clientSecret`, `idToken`, `refreshToken`, `sessionId`) are caught. JavaScript apps use camelCase query names often. A fix needs a case-sensitive camel-boundary check outside the `/i` regex; `[_-]?` would match `monkey`.

3. **Hash-router fragments are not masked (leak gap).** `/#/login?token=abc` is unchanged. The fragment `/login?token=abc` becomes one pair whose name is `/login?token`, which fails `SECRET_PARAM`. Splitting a fragment at its first `?` before `maskPairs` would cover SPA hash routing.

4. **Over-masking (safe, but less readable):** `?country_code=US&status_code=404` gets both values masked (`*_code`). `?token=abc;page=2` masks `page` too, since `;` is not a separator.

5. **Cosmetic:** `(see https://x.test/?token=abc)` → `(see https://x.test/?token=[REDACTED]`. The closing paren becomes part of the masked value. `api/items?token=abc` (relative, no leading `/`) is not matched in text.

Concerns 1–3 matter for the security model ("URLs in traces never carry tokens"). 4–5 are minor.

---

## Fix report (lead ruling: fix concerns 1–3, keep 4)

**Status:** DONE_WITH_CONCERNS
**Commit:** `6dead4e` Mask camelCase and hash-router URL credentials; scan URLs in linear time (on top of `3731478`)

### Changes

1. **Linear `URL_IN_TEXT`.** Replaced with the lookbehind regex. A scheme must start its run of scheme characters, and a path must start the text or follow whitespace or a quote. A comment explains why (unbounded console text from the app under review) and names the accepted loss: a path glued to other text, such as `url=/a?token=…`.
2. **camelCase credential names.** `SECRET_PARAM` is now one suffix match, case-insensitive: a name counts when it ends with `token|key|secret|session|session[_-]?id|sid|signature|sig|password|passwd|pwd|auth|authorization|code|credentials?|jwt|otp`. That is the lead's list plus the names the brief already masked, so nothing previously masked is now unmasked. The brief's whole-name forms (`sid`, `pwd`, `jwt`, `otp`, `authorization`, `session_id`) also became suffixes, which catches `userSid` and `appSessionId`.
3. **Hash-router fragments.** A new `maskFragment` runs when a fragment starts with `/` or `!` and contains `?`: it masks the pairs after the `?`. Other fragments behave as before (`#access_token=…`).

The public API (`redactUrl`, `redactUrls`) is unchanged.

### Deviation to note: `monkey`

The lead's rule ("lower-cased, ends with … key") masks `monkey`, but the brief's ordinary-URL test asserted `/kb?keyboard=us&monkey=1` stays unchanged. I followed the newer ruling and the lead's "over-masking is the safer side" principle. `monkey=1` became `tokenizer=1`, which keeps the test's intent: a credential word inside a name, but not at its end, stays readable. The `SECRET_PARAM` comment says names like `monkey` and `barcode` are now masked. To restore `monkey`, a boundary rule would be needed instead (a separator or a lower-to-upper case change before `key`), and that would let run-together names such as `privatekey` and `secretkey` through.

### Tests added

- Ordinary list: `/items?id=7&page=2&q=keys` (negative for `id`, `page`, `q`), `/kb?keyboard=us&tokenizer=1`, `/#/items` (hash route without a query).
- `masks camelCase and run-together credential names`: `authToken`, `privateKey`, `csrftoken`, `X-Auth` are masked; `page` is kept.
- `masks the query inside a hash-router fragment`: `/#/login?token=abc&next=%2Fhome` and `https://x.test/#!/cb?code=zz9`.
- `stays fast on hostile text`: `'/-'.repeat(100_000)` comes back unchanged in under 250 ms.

### TDD evidence

RED: `npx vitest run packages/core/test/redact.test.ts`
```
 FAIL  … > masks camelCase and run-together credential names
Received: "/a?authToken=t1&privateKey=k1&csrftoken=c1&X-Auth=[REDACTED]&page=2"
 FAIL  … > masks the query inside a hash-router fragment
Received: "/#/login?token=abc&next=%2Fhome"
 FAIL  … > stays fast on hostile text
AssertionError: expected 12845.0585 to be less than 250
      Tests  3 failed | 10 passed (13)
```

GREEN: `npx vitest run packages/core/test/redact.test.ts`
```
 ✓ packages/core/test/redact.test.ts (13 tests) 6ms
      Tests  13 passed (13)
```

Verification: `npx vitest run packages/core` → 15 files, 159 tests passed. `npm run typecheck` → exit 0. `npm run lint` → 270 files, no fixes, exit 0.

### Remaining concern (pre-existing, outside this ruling)

`redactUrls` still ends with `redact()`, and two of `redact()`'s existing patterns are quadratic on hostile text. Every artifact goes through them, diffs included, and that predates this PR. Measured with `scratchpad/probe/redact-split.ts`:
- `URL_CREDENTIALS` (`\b[a-z][a-z0-9+.-]*:\/\/…`): `'a.'.repeat(40_000)`, 80k chars → `redact()` 1836 ms.
- `jwt` (`\beyJ[A-Za-z0-9_-]{10,}\.eyJ…`): `'eyJ-'.repeat(40_000)`, 160k chars → `redact()` 13678 ms.

The new `URL_IN_TEXT` adds about nothing on these inputs (1 ms at 160k in isolation). A follow-up could anchor both patterns: `(?<![a-z0-9+.-])` for the scheme, and `(?<![A-Za-z0-9_-])` before `eyJ` for the JWT pattern.
