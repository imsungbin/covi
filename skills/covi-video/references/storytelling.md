# Storytelling patterns

A review video is a walkthrough that starts in the middle: open on the thing itself, show it, say why it matters, say what to check, and stop. The templates in `covi templates` encode the patterns below as beats. They are suggestions: order the beats the way the evidence tells the story, keeping only the two fixed points, the cold open first and a short wrap last. This page explains the thinking behind them so you can adapt when no template fits.

## What every video shares

- **A cold open.** The first frame shows the subject: the captured screen, the terminal, or the key lines, with a short form of the title as the eyebrow. The first line is a hook: a question ("What happens to your comment when the request fails?"), a surprising fact from the evidence ("Remove one too many, and the cart says minus one."), or the payoff ("Your comment now appears before the server answers."). Never "This change shows…", and never a table of contents.
- **One hero.** The moment the change clicks: the bug reproducing, the key lines side by side with the thing they fix, the after state landing. Give it the template's first hero beat (named in each pattern below), the strongest capture, and the line that pays off the hook. The beat is only how Covi finds the hero; viewers read the eyebrow. Give no earlier scene that beat, not even a cold open showing the same screen: Covi takes the first scene that plays it. The cold open plays the template's opening beat, `context`.
- **Short scenes.** Two to five seconds each. A beat that needs longer becomes two scenes: an interaction's setup, then the click; the fix in one file, then the other; before, then after.
- **A short wrap.** The summary card with `minSeconds: 1.5` and one line of eight words or fewer, or none: Covi's outro carries the verdict.

## The list is the map

When a change leaves two to four things to check, let them structure the video. Promise them up front, visit each, and come back to strike them off:

1. "There are three places this could break." (the hook, over the riskiest lines or the change map)
2. One scene per place, with the eyebrows "1 of 3", "2 of 3", and "3 of 3".
3. "All three hold up. One question left: what about offline?" (the return, then a bonus question if there is one)

Use it only when the change hands you the list. A video with one thing to check needs no map.

## Bug fix
1. **Cold open**: the bug on the base revision, as a screenshot, terminal output, or API response that shows the wrong behavior. Hook: "Remove one too many, and the cart says minus one."
2. **The fix**: the two or three lines that matter, highlighted. Say why they work, not what they say. Two files, two scenes.
3. **After**, the hero (beat `proof`): the same steps on head, now correct. Without an after capture, the fix lines are the hero: give that scene the beat `proof`.
4. **Worth a look**: the regression risk ("clamping at zero changes what undo restores").
5. **Wrap**: the verdict in a few words.

## New feature
1. **Cold open**: the new behavior on head, mid-interaction. Hook: the payoff, or the question it answers.
2. **Before** (optional): the old workflow, briefly, only if the contrast helps.
3. **See it**, the hero (beat `interaction`): the key interaction with the cursor and clicks, one or two steps per scene.
4. **How it works**: the one implementation detail reviewers need.
5. **Worth a look**: the edge case or finding to check.
6. **Wrap**.

## Visual change
1. **Cold open**: the after state, with the changed region in focus.
2. **Before / after**, the hero (beat `compare`): both versions with the changed region highlighted (the pixel diff provides the focus).
3. **Up close** (optional): zoom into the region, or show another viewport.
4. **The styles** (optional): the rules responsible.
5. **Worth a look**: accessibility, responsive, or consistency concerns.
6. **Wrap**.

## API change
1. **Cold open**: the new response, with the field that changed. Hook: what the captured bodies show ("The old response listed five entries; the new one pages them.").
2. **Request / response**, the hero (beat `exchange`): the real responses before and after; Covi highlights changed lines.
3. **Handler** (optional): the lines that produce the new behavior.
4. **Compatibility**: who could break and what to verify.
5. **Wrap**.

## CLI change
1. **Cold open**: the command's new output.
2. **Run it**, the hero (beat `run`): the same command before and after.
3. **The change**: the lines responsible.
4. **Worth a look**: input handling, output compatibility for scripts.
5. **Wrap**.

## Architecture explainer
Only for large restructurings with nothing to click.
1. **Cold open**: the key seam's lines, or the change map, with the question the restructuring answers.
2. **The shape**, the hero (beat `map`): modules and how they relate now (diagram or change map).
3. **Key seam**: the interface or boundary that matters most.
4. **Worth a look**: where behavior could have changed by accident.
5. **Wrap**: the verdict, and where to start reading.

## Pacing
- Short-form (9:16, 20–35 s): six to nine scenes, one idea each, the review note always included.
- Standard (16:9, 60–120 s): ten to fourteen scenes, with room for before states, implementation detail, and a second finding. A storyboard holds at most 14 scenes, so a long standard review lets its scenes run a little past five seconds.
- Covi holds each visual long enough to read it, whatever the line, so an interaction of three or more steps, or a findings card with four or more findings, runs past five seconds. That is fine: its steps or findings keep it moving. Still, split the steps of a long interaction across scenes when you can.
