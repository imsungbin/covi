import type { EvidenceIndex, EvidenceItem, EvidenceKind } from '@covi/core';
import { findPhrase, parseEmphasis } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import { shown } from './echo.ts';
import { beatTargets, flowBeatProblems, pileProblems } from './flow.ts';
import { countProblem, metricProblems } from './metric.ts';
import type { Direction, ShotBeat, ShotElement } from './schema.ts';
import {
  type DirectionSources,
  hunkView,
  startupLog,
  UNKNOWN_EVIDENCE as UNKNOWN,
} from './sources.ts';
import { morphProblem } from './tokens.ts';

/** What the checks read of a storyboard scene. */
export type DirectedScene = Pick<Scene, 'id' | 'narration'> & {
  visual: Pick<Scene['visual'], 'kind'>;
};

/**
 * Storyboard cards a shot shows only alone: they draw their own header and large fox, which the
 * outro takes over, and a slot beside other elements can honor neither.
 */
const WHOLE_ONLY = new Set<Scene['visual']['kind']>(['title', 'summary']);

/** The kind of element each verb that acts on an element works on; it acts on each one once. */
const ACTS_ON: Partial<Record<ShotBeat['verb'], ShotElement['kind']>> = {
  morph: 'morph',
  count: 'metric',
  stack: 'pile',
};

/**
 * What the schema alone cannot check, as lines that name the shot, element, and beat: shots name
 * storyboard scenes (one each), beats name elements of their shot, a title or summary card is
 * shown only alone, every cited id is in the run's evidence with the kind its element shows, a
 * requested side exists, lines lie within the side shown, a morph's hunk can morph, a metric has
 * the values its element shows (a pile, whole counts), a verb that acts on an element names one of
 * its kind (once), a count has two values to tick between, flow verbs ask only what their
 * elements can do (`flowBeatProblems`), and every `at` is quoted from the scene's narration
 * exactly once (as `sync` phrases are).
 */
export function directionProblems(
  direction: Pick<Direction, 'shots'>,
  scenes: readonly DirectedScene[],
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const problems: string[] = [];
  const byId = new Map(scenes.map((s, i) => [s.id ?? `s${i + 1}`, s]));
  const directed = new Set<string>();
  direction.shots.forEach((shot, i) => {
    const sceneId = shown(shot.scene);
    const where = `shot ${i + 1} (scene ${sceneId})`;
    const scene = byId.get(shot.scene);
    // A shot for no scene is still checked through, so every problem it has is listed at once;
    // only its phrases, which need the scene's narration, are not.
    if (!scene)
      problems.push(
        `${where}: the storyboard has no scene "${sceneId}" (it has: ${[...byId.keys()].map(shown).join(', ')})`,
      );
    else if (directed.has(shot.scene))
      problems.push(`${where}: scene ${sceneId} already has a shot; give each scene at most one`);
    else directed.add(shot.scene);
    if (shot.layout === 'single' && shot.elements.length > 1)
      problems.push(
        `${where}: layout "single" shows one element, and the shot has ${shot.elements.length}`,
      );
    // Shown whole exactly when the shot resolves whole: the visual alone, never revealed.
    const visual = shot.elements.find((e) => e.kind === 'visual');
    const revealed = shot.beats.some((b) => b.verb === 'reveal' && b.element === visual?.id);
    if (
      scene &&
      visual &&
      WHOLE_ONLY.has(scene.visual.kind) &&
      (shot.elements.length > 1 || revealed)
    )
      problems.push(
        `${where}, element ${visual.id}: a ${scene.visual.kind} card draws its own header and fox, so it is shown only alone; make it the shot's one element, without a reveal, or leave it out`,
      );
    const elements = new Map<string, ShotElement>();
    for (const element of shot.elements) {
      if (elements.has(element.id))
        problems.push(`${where}: element id "${element.id}" is used twice`);
      else elements.set(element.id, element);
      for (const problem of elementProblems(element, evidence, sources))
        problems.push(`${where}, element ${element.id}: ${problem}`);
    }
    const text = scene && parseEmphasis(scene.narration).text;
    const acted = new Set<string>();
    shot.beats.forEach((beat, k) => {
      const name = `${where}, beat ${k + 1} (${beat.verb})`;
      const targets = beatTargets(beat);
      const missing = targets.filter((id) => !elements.has(id));
      for (const id of missing)
        problems.push(
          `${name}: the shot has no element "${id}" (it has: ${[...elements.keys()].join(', ')})`,
        );
      const target = targets[0]!;
      const element = elements.get(target);
      const kind = element?.kind;
      const needs = ACTS_ON[beat.verb];
      // An element the shot lacks is reported above; it neither has a kind nor acts.
      if (needs && kind) {
        const key = `${beat.verb}:${target}`;
        if (kind !== needs)
          problems.push(
            `${name}: ${beat.verb} acts on a ${needs} element, and "${target}" is a ${kind}`,
          );
        else if (acted.has(key))
          problems.push(
            `${name}: "${target}" already ${beat.verb}s at an earlier beat; it ${beat.verb}s once`,
          );
        acted.add(key);
      }
      // A count ticks from base to head: its metric element must show both, and have both.
      if (beat.verb === 'count' && element?.kind === 'metric') {
        const problem = countProblem(element, sources.metric(element.evidence));
        if (problem) problems.push(`${name}: ${problem}`);
      }
      if (!missing.length)
        for (const problem of flowBeatProblems(shot, k, evidence, sources))
          problems.push(`${name}: ${problem}`);
      if (beat.verb === 'place' || beat.at === undefined || text === undefined) return;
      const at = findPhrase(text, beat.at);
      if (at.count === 0)
        problems.push(`${name} quotes "${shown(beat.at)}", which is not in the scene's narration`);
      else if (at.count > 1)
        problems.push(
          `${name} quotes "${shown(beat.at)}", which appears ${at.count} times in the scene's narration; quote enough words to make it unique`,
        );
    });
  });
  return problems;
}

function elementProblems(
  element: ShotElement,
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const out: string[] = [];
  /** The `kind` item `id` names in the run's evidence; says why there is none. */
  const cites = (id: string, kind: EvidenceKind, what: string): EvidenceItem | undefined => {
    const item = evidence?.find(id);
    if (!item) out.push(`cites "${shown(id)}", ${UNKNOWN}`);
    else if (item.kind !== kind)
      out.push(`${what} shows a ${kind}: item, and "${shown(id)}" is a ${item.kind}`);
    return item?.kind === kind ? item : undefined;
  };
  switch (element.kind) {
    case 'code': {
      if (!cites(element.evidence, 'diff-hunk', 'a code element')) break;
      const hunk = sources.hunk(element.evidence);
      if (!hunk) {
        out.push(`Covi cannot find hunk "${shown(element.evidence)}" in the run's diff`);
        break;
      }
      const side = element.side ?? 'head';
      const view = hunkView(hunk.lines, side);
      if (!view.length)
        out.push(
          `the hunk has no ${side} lines; show side "${side === 'head' ? 'base' : 'head'}" or "diff"`,
        );
      else if (element.lines && element.lines[1] > view.length)
        out.push(
          `lines [${element.lines[0]}, ${element.lines[1]}] run past the ${view.length} lines of its ${side} side`,
        );
      break;
    }
    case 'output': {
      const item = cites(element.evidence, 'terminal', 'an output element');
      if (!item) break;
      const command = sources.command(element.evidence);
      const log = startupLog(item.id);
      if (!command) out.push(`the run has no output for "${shown(element.evidence)}"`);
      else if (element.side === 'base' && log)
        out.push(
          `side "base": "${shown(element.evidence)}" is the app's start-up log at ${log}, its only output; leave side out`,
        );
      else if (element.side === 'base' && command.before === undefined)
        out.push(`side "base": "${shown(element.evidence)}" ran only after the change`);
      break;
    }
    case 'morph': {
      if (!cites(element.evidence, 'diff-hunk', 'a morph element')) break;
      const hunk = sources.hunk(element.evidence);
      const problem = hunk
        ? morphProblem(hunk.lines)
        : `Covi cannot find hunk "${shown(element.evidence)}" in the run's diff`;
      if (problem) out.push(problem);
      break;
    }
    case 'metric': {
      // A metric item always carries its values (the registry's schema), so it has a source.
      if (!cites(element.evidence, 'metric', 'a metric element')) break;
      const metric = sources.metric(element.evidence);
      if (metric) out.push(...metricProblems(element, metric));
      break;
    }
    case 'pile': {
      // As a metric element's: its item carries its values, so it has a source.
      if (!cites(element.evidence, 'metric', 'a pile')) break;
      const metric = sources.metric(element.evidence);
      if (metric) out.push(...pileProblems(element, metric));
      break;
    }
    case 'capture':
      // Any screenshot item has an image to show; that the file is there and readable is checked
      // where it is loaded, as a storyboard's captures are.
      cites(element.evidence, 'screenshot', 'a capture element');
      break;
    case 'node':
      for (const id of element.evidence ?? [])
        if (!evidence?.find(id)) out.push(`cites "${shown(id)}", ${UNKNOWN}`);
      break;
  }
  return out;
}
