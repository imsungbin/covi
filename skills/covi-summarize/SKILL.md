---
name: covi-summarize
description: Summarize a code change for a pull/merge request description, a changelog entry, a release note, or a standup or chat update, grounded in Covi's understanding of the change.
---

# Summarize a change

A summary is the shortest accurate account of a change for a specific reader. Ask yourself who reads it and what they do next.

## Run it

```bash
covi summarize --json                 # markdown summary (PR/MR description style)
covi summarize --format text          # one paragraph for chat or standups
```

Covi grounds the summary in its understanding and review of the change. Improve the wording if you have read the code more deeply, but keep every statement true.

## Method

| Purpose | Shape |
|---|---|
| PR/MR description | Title (imperative, under about 60 characters) · two or three sentences on what and why · key changes by area · review focus · testing notes |
| Changelog or release note | One line per user-visible change, written for users: what they can now do or what was fixed. Internal changes are omitted or grouped. |
| Standup or chat | One or two sentences: what changed, its status (review verdict, open questions). |

- Lead with the outcome, not the activity ("Comments appear instantly while saving", not "Refactored comment hooks").
- Keep identifiers out of user-facing notes; keep them in PR descriptions.
- Mention risks or follow-ups the reader must act on; leave out the rest.
- Never claim testing or verification that did not happen.

## Output files

`summary.md` in the run directory (also produced by `covi review`).
