# Review checklists

Use these to make sure you looked in the right places. They are prompts for thinking, not a form to fill in: skip what does not apply and report only what you can support with evidence.

## Correctness and regressions
- Does the code do what the explanation says, for every branch of the conditionals it touches?
- Off-by-one, inclusive and exclusive bounds, empty collections, null and undefined, NaN, time zones, locale.
- Callers of changed functions: do they still pass and expect the same things?
- Removed behavior: was anything relied upon (callbacks, events, side effects, return values)?

## Edge cases and error handling
- What happens on failure: network, disk, parse, permission, timeout? Is the failure surfaced, retried, or swallowed?
- Partial failure: are earlier side effects rolled back or left half-done?
- Are errors that used to be handled still handled?

## State consistency and concurrency
- Optimistic updates: what reconciles or rolls back when the server disagrees?
- Shared mutable state, caches, memoization keys: invalidated when inputs change?
- Races: two requests, double clicks, retries, out-of-order responses, async work in loops.
- Idempotency of handlers that may be retried.

## Security and permissions
- Untrusted input reaching queries, HTML, shell commands, file paths, redirects, deserialization.
- Authorization checked on the server for every new route or mutation, not just hidden in the UI.
- Secrets: committed, logged, sent to clients, or exposed in error messages.
- CI workflows: `pull_request_target`, untrusted expressions in `run:`, token permissions.

## API compatibility
- Response and request shapes, status codes, field names, types, nullability, pagination.
- Removed or renamed routes, exports, CLI flags, config keys, environment variables.
- Old clients and cached frontends still in the field during and after deploy.

## Data integrity
- Migrations: destructive operations, locks on large tables, defaults and backfills, reversibility.
- Code that runs during the deploy window against the old or the new schema.
- Validation at the boundary before data is persisted.

## Performance
- New work on hot paths: loops over network or database calls (N+1), unbounded queries, large payloads.
- Work moved to render paths or request handlers that used to be cached or batched.

## Accessibility and UI behavior
- Semantic elements for interactive controls; keyboard access; visible focus.
- Text alternatives for images; labels for inputs; announced status changes.
- Contrast, zoom and reflow, reduced motion.
- Empty, loading, error, and overflow states; long text; small screens.

## Tests
- Is the changed behavior covered? For bug fixes, does a test fail without the fix?
- Do tests assert outcomes or just run the code?
- Skipped, focused, or weakened assertions.

## Maintainability and complexity
- Is there a simpler way that the codebase already uses?
- Duplicated logic that should share one implementation; new abstractions with one caller.
- Names and comments that will mislead the next reader.

## Intent
- Does the implementation match the stated intent? Unannounced behavior changes are findings, usually questions.
