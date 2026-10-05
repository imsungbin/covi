@AGENTS.md

## Claude Code notes

- Covi's skills are available as project skills through `.claude/skills` (a link to `skills/`). Start any Covi request with the `covi` skill.
- When `covi-video` says to ask the user, use AskUserQuestion with the options `covi video --dry-run --json` returns, all in one call. If the user picks Custom, run the dry run again with `--custom` and ask the size question it returns.
- When Covi withholds untrusted repository commands, show the user the list from `covi trust --json` and ask with AskUserQuestion before running `covi trust --yes`.
- To check a rendered video, open `video/contact-sheet.jpg` and `video/poster.png` with the Read tool; it shows images.
