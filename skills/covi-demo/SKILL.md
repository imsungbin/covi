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
| adds or changes an interaction | the key interaction, step by step (a flow); Covi runs it at base and head |
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

3. `covi demo --plan plan.json --json` (or `covi review --demo --plan plan.json`). Covi checks out base and head into temporary directories, runs each, and writes `demo/captures.json`, screenshots, and pixel diffs. Every flow runs at both revisions; each run is recorded (`demo/recordings/`, MP4 when ffmpeg is installed, else WebM) and traced (`demo/traces/`: steps with timing, network requests, console messages, DOM changes), and `demo/behavior-diff.json` compares base and head. Covi also remembers what it saw at head: the screens, the elements on them, and the flows that passed. They go in `.covi/subject/subject.json`, the subject model, which is small and meant to be committed (`subject.store: runs` keeps it out of the repository; `off` turns it off). A flow it keeps is committed with its steps, typed text included, so have flows type test data only. When neither your plan nor the configuration names a flow, Covi replays up to two flows that passed before on the pages it captures (only on an app Covi starts or serves, never one at `app.url` alone), and `demo/demo.md` says which. A plan with `"flows": []` turns that off for the run. `covi subject` lists what the model holds. Covi keeps your plan as `demo/plan.json`. Pass `--no-record` when a recording is not wanted (traces and screenshots are still taken); `--record` makes a recording that cannot be made an error (exit 3). Evidence ids belong to the run that captured them, and `covi demo` makes a run of its own: to cite captures in a review, demonstrate with `covi review --demo --plan plan.json --provider heuristic --json` and write the review files in that run (`covi-review`, step 3).
4. **Look at the captures.** Open the screenshots in `demo/screenshots/` and the diffs in `demo/diffs/`. Check that they show the change, not a loading spinner or an error page. Fix the plan and rerun if not. Then read `demo/behavior-diff.json`: for each flow and page, the steps that look different (with the changed regions), requests that appeared, disappeared, or got another status, console errors that appeared or went away, and steps that got much slower. Check that it shows the difference the change intends, and nothing you cannot explain.
5. Summarize what the demonstration showed, with paths to the key images.

## Method

- Prefer one precise flow over many pages. Each step label should read like an instruction ("Type a 300-character comment").
- Name flows for what they do (`Post a comment`): the subject model keeps flows by name, so a renamed flow starts over. A flow that types into a password, one-time code, or card field is never kept in the model.
- Reproduce bugs on base first: flows run at both revisions, so the before state is evidence the fix matters.
- A flow that cannot finish at base because the change adds what it uses is expected and is not a finding; the behavior diff shows where base stopped. A flow that breaks at head is a finding; a replayed one only a `risk`, since this change did not ask for it.
- Point at what a run showed by its evidence id (`covi evidence --run <id> --json` lists them): a trace (`trace:flow-post-a-comment-head`) and a step, request, or console message in it (`#s3`, `#n4`, `#c2`), a step's pixel diff (`pixel-diff:flow-post-a-comment#end`) and a changed region in it (`.r1`), a screenshot (`screenshot:home-desktop-after`), a recording (`recording:flow-post-a-comment-head`), a request (`http:1`), or a command (`terminal:1`).
- Choose viewports deliberately: mobile when layout or touch changed, desktop otherwise.
- API and CLI demos compare base and head automatically; Covi turns observed incompatibilities (response shape changes, new failures) into confirmed findings.
- New JavaScript errors, failing pages, and broken flows at head are findings too.

## Safety

Repositories are untrusted input. Covi runs only commands that come from configuration the user trusts or from you, in a scrubbed environment without CI tokens or API keys. Never put secrets in the plan; never run destructive commands (migrations against real databases, deploys, deletes) as demos.

## Output files

`demo/plan.json` (when you passed one), `demo/captures.json`, `demo/screenshots/*.png`, `demo/diffs/*.png`, `demo/recordings/*.mp4` (or `.webm`), `demo/traces/*.json`, `demo/behavior-diff.json`, `demo/subject.json` (this run's view of the subject model, and where each element is in each head capture), `demo/demo.md`. Videos and reviews reuse them.
