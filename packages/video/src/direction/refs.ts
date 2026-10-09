import { type EvidenceIndex, type EvidenceKind, escapeUnprintable } from '@covi/core';
import { findPhrase, parseEmphasis } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import type { Direction, ShotElement } from './schema.ts';
import { type DirectionSources, hunkView } from './sources.ts';

/** Characters of a cited id, a phrase, or a scene id a problem echoes. */
const ECHO_CHARS = 120;

/**
 * Text from the direction or the storyboard as a problem echoes it: their authors may be hostile,
 * so nothing unprintable reaches the terminal raw, and a long value is cut.
 */
const shown = (text: string) => escapeUnprintable(text, ECHO_CHARS);

/**
 * What the schema alone cannot check, as lines that name the shot, element, and beat: shots name
 * storyboard scenes (one each), beats name elements of their shot, every cited id is in the run's
 * evidence with the kind its element shows, a requested side exists, lines lie within the side
 * shown, and every `at` is quoted from the scene's narration exactly once (as `sync` phrases are).
 */
export function directionProblems(
  direction: Pick<Direction, 'shots'>,
  scenes: ReadonlyArray<Pick<Scene, 'id' | 'narration'>>,
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
    if (!scene) {
      problems.push(
        `${where}: the storyboard has no scene "${sceneId}" (it has: ${[...byId.keys()].map(shown).join(', ')})`,
      );
      return;
    }
    if (directed.has(shot.scene))
      problems.push(`${where}: scene ${sceneId} already has a shot; give each scene at most one`);
    directed.add(shot.scene);
    if (shot.layout === 'single' && shot.elements.length > 1)
      problems.push(
        `${where}: layout "single" shows one element, and the shot has ${shot.elements.length}`,
      );
    const ids = new Set<string>();
    for (const element of shot.elements) {
      if (ids.has(element.id)) problems.push(`${where}: element id "${element.id}" is used twice`);
      ids.add(element.id);
      for (const problem of elementProblems(element, evidence, sources))
        problems.push(`${where}, element ${element.id}: ${problem}`);
    }
    const text = parseEmphasis(scene.narration).text;
    shot.beats.forEach((beat, k) => {
      const name = `${where}, beat ${k + 1} (${beat.verb})`;
      const target = beat.verb === 'camera' ? beat.to : beat.element;
      if (!ids.has(target))
        problems.push(
          `${name}: the shot has no element "${target}" (it has: ${[...ids].join(', ')})`,
        );
      if (beat.verb === 'place' || beat.at === undefined) return;
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

const UNKNOWN = "which the run's evidence does not have (`covi evidence --run <id>` lists it)";

function elementProblems(
  element: ShotElement,
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const out: string[] = [];
  /** Whether `id` is in the run's evidence as a `kind` item; says why not. */
  const cites = (id: string, kind: EvidenceKind, what: string) => {
    const item = evidence?.find(id);
    if (!item) out.push(`cites "${shown(id)}", ${UNKNOWN}`);
    else if (item.kind !== kind)
      out.push(`${what} shows a ${kind}: item, and "${shown(id)}" is a ${item.kind}`);
    return item?.kind === kind;
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
      if (!cites(element.evidence, 'terminal', 'an output element')) break;
      const command = sources.command(element.evidence);
      if (!command) out.push(`the run has no output for "${shown(element.evidence)}"`);
      else if ((element.side ?? 'head') === 'base' && command.before === undefined)
        out.push(`side "base": "${shown(element.evidence)}" ran only after the change`);
      break;
    }
    case 'capture':
      if (
        cites(element.evidence, 'screenshot', 'a capture element') &&
        !sources.capture(element.evidence)
      )
        out.push(`the run has no image for "${shown(element.evidence)}"`);
      break;
    case 'node':
      for (const id of element.evidence ?? [])
        if (!evidence?.find(id)) out.push(`cites "${shown(id)}", ${UNKNOWN}`);
      break;
  }
  return out;
}
