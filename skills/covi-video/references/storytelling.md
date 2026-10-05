# Storytelling patterns

Review videos follow the same arc as a good verbal walkthrough: **context → what changed → show it → why it matters → what to check**. The templates in `covi templates` encode these patterns as beats; this page explains the thinking behind them so you can adapt when no template fits.

## Bug fix
1. **The bug** (title): name what was broken and where. "This fixes cart quantities going negative."
2. **Before**: reproduce it on the base revision: a screenshot, terminal output, or API response that shows the wrong behavior.
3. **The fix**: the two or three lines that matter, highlighted. Say why they work, not what they say.
4. **After** (optional): the same steps on head, now correct.
5. **Worth a look**: the regression risk ("removing the line at zero changes what undo restores").
6. **Summary**: verdict and next step.

## New feature
1. **New behavior**: what users can do now.
2. **Before** (optional): the old workflow, briefly, only if the contrast helps.
3. **See it**: the key interaction, step by step, with the cursor and clicks.
4. **How it works**: the one implementation detail reviewers need.
5. **Worth a look**: the edge case or finding to check.
6. **Summary**.

## Visual change
1. **Visual change**: name it.
2. **Before / after**: both versions with the changed region highlighted (the pixel diff provides the focus).
3. **Up close** (optional): zoom into the region, or show another viewport.
4. **The styles** (optional): the rules responsible.
5. **Worth a look**: accessibility, responsive, or consistency concerns.
6. **Summary**.

## API change
1. **API change**: the endpoint and what changed.
2. **Request / response**: the real responses before and after; Covi highlights changed lines.
3. **Handler** (optional): the lines that produce the new behavior.
4. **Compatibility**: who could break and what to verify.
5. **Summary**.

## CLI change
1. **CLI change**: the command and the behavior change.
2. **Run it**: the same command before and after.
3. **The change**: the lines responsible.
4. **Worth a look**: input handling, output compatibility for scripts.
5. **Summary**.

## Architecture explainer
Only for large restructurings with nothing to click.
1. **Why**: the reason the structure changed.
2. **The shape**: modules and how they relate now (diagram or change map).
3. **Key seam**: the interface or boundary that matters most.
4. **Worth a look**: where behavior could have changed by accident.
5. **Summary** with a suggested reading order.

## Pacing
- Short-form (9:16, 20–35 s): four or five scenes, one idea each, the review note always included.
- Standard (16:9, 60–120 s): room for before states, implementation detail, and a second finding.
- Hold visual scenes long enough to read: code at least 3–4 seconds, before/after at least 4.
