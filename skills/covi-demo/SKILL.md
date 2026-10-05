---
name: covi-demo
description: Demonstrate a code change by running the software at the base and head revisions and capturing exactly what a reviewer needs to see - UI states, interactions, before/after screenshots, API responses, or CLI output. Use for "demo this change", "show me it working", "screenshots of the change".
---

# Demonstrate a change

The question that drives every demonstration: **what does the reviewer need to see to understand or trust this change?** Capture that, and nothing else. Random screen recordings do not help anyone.

## Decide what to show

| The change… | Show |
|---|---|
| fixes a user-visible bug | the bug on base, then the same steps on head |
| adds or changes an interaction | the key interaction on head, step by step (a flow) |
| changes appearance | before/after of the affected page, at the viewports that matter |
| changes an API | the same request against base and head; the response difference |
| changes a CLI | the same command against base and head; the output difference |
| changes error handling | the error state itself, triggered on purpose |
| is internal (refactor, tests, CI, types) | nothing; say so, and let the explanation carry it |

`context.json` → `demonstration` already holds Covi's assessment (value, kinds, candidates, whether it can run the project). Use it as a starting point, not a verdict.

## Run it

1. Check that Covi can run the project: `demonstration.runnable` in `context.json`. Static sites are served as-is. Apps need `app.start` (and usually `app.install`, `app.url`) in `.covi/config.yml`; ask the user before adding commands you invented.
   If Covi reports that commands in the configuration are not trusted on this machine yet, show the user the exact commands (`covi trust` prints them) and ask before running `covi trust --yes`. Never trust them on your own: a pull request can edit that file.
2. Write a plan when the defaults are not enough (`covi schema demo-plan`):

   ```json
   {
     "pages": ["/pricing"],
     "viewports": ["desktop", "mobile"],
     "flows": [
       { "name": "Post a comment", "path": "/posts/1", "steps": [
         { "fill": "textarea[name=comment]", "text": "Looks good to me" },
         { "click": "button:has-text('Post')", "note": "Post the comment" },
         { "wait": 300 }
       ] }
     ],
     "requests": [{ "name": "List users", "method": "GET", "path": "/api/users" }],
     "commands": [{ "name": "Help", "run": "node bin/cli.js --help" }]
   }
   ```

3. `covi demo --plan plan.json --json` (or `covi review --demo --plan plan.json`). Covi checks out base and head into temporary directories, runs each, and writes `demo/captures.json`, screenshots, and pixel diffs. It keeps your plan as `demo/plan.json`.
4. **Look at the captures.** Open the screenshots in `demo/screenshots/` and the diffs in `demo/diffs/`. Check that they show the change, not a loading spinner or an error page. Fix the plan and rerun if not.
5. Summarize what the demonstration showed, with paths to the key images.

## Method

- Prefer one precise flow over many pages. Each step label should read like an instruction ("Type a 300-character comment").
- Reproduce bugs on base first: the before state is evidence the fix matters.
- Choose viewports deliberately: mobile when layout or touch changed, desktop otherwise.
- API and CLI demos compare base and head automatically; Covi turns observed incompatibilities (response shape changes, new failures) into confirmed findings.
- New JavaScript errors, failing pages, and broken flows at head are findings too.

## Safety

Repositories are untrusted input. Covi runs only commands that come from configuration the user trusts or from you, in a scrubbed environment without CI tokens or API keys. Never put secrets in the plan; never run destructive commands (migrations against real databases, deploys, deletes) as demos.

## Output files

`demo/plan.json` (when you passed one), `demo/captures.json`, `demo/screenshots/*.png`, `demo/diffs/*.png`, `demo/demo.md`. Videos and reviews reuse them.
