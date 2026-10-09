import {
  EVIDENCE_LIMITS,
  type EvidenceIndex,
  type Explanation,
  type Finding,
  hunksAt,
  truncate,
  ungroundedStatements,
  unknownCitations,
} from '@covi/core';
import type { Shot } from './direction/schema.ts';
import type { QcCheck } from './qc.ts';
import type { Scene, Visual } from './storyboard/schema.ts';

/** Visuals that frame the story (title, change map, wrap-up) rather than claim anything. */
const FRAMING = new Set(['title', 'change-map', 'summary', 'outro']);

/**
 * Run-relative images a visual shows: every `{ path }` object inside it, wherever its kind keeps
 * them. A code visual's `path` names a source file, and a top-level `path` (an API route) is not
 * an object, so neither is collected.
 */
export function visualImages(visual: Visual): string[] {
  if (visual.kind === 'code') return [];
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) for (const v of value) walk(v);
    else if (value && typeof value === 'object') {
      const path = (value as { path?: unknown }).path;
      if (typeof path === 'string') out.push(path);
      for (const v of Object.values(value)) if (v && typeof v === 'object') walk(v);
    }
  };
  for (const value of Object.values(visual)) if (value && typeof value === 'object') walk(value);
  return out;
}

/**
 * The evidence a scene rests on: the ids it cites, then what is on screen from the run. Without
 * direction, or when its shot keeps the storyboard visual, that is what the visual shows (the
 * captured images, the diff hunks of its code, the request, command, or findings on screen); a
 * shot adds what its elements cite, and a shot without the visual replaces it. `shot` is what is
 * on screen of the scene's shot once resolved (`shownShot`), never the plan's: an element whose
 * content the run lacks is not drawn, and when none is, the storyboard visual shows instead.
 */
export function sceneEvidence(
  scene: Pick<Scene, 'visual' | 'evidenceIds'>,
  index: EvidenceIndex,
  findings: ReadonlyArray<Pick<Finding, 'title' | 'evidenceIds'>> = [],
  shot?: Pick<Shot, 'elements'>,
): string[] {
  const ids = [...(scene.evidenceIds ?? [])];
  if (!shot || shot.elements.some((e) => e.kind === 'visual'))
    ids.push(...visualEvidence(scene.visual, index, findings));
  for (const e of shot?.elements ?? []) {
    const cited = e.kind === 'node' ? (e.evidence ?? []) : 'evidence' in e ? [e.evidence] : [];
    // Stored as the registry holds it, like every other id the timeline records.
    for (const id of cited) {
      const item = index.find(id);
      if (item) ids.push(item.id);
    }
  }
  return [...new Set(ids)].slice(0, EVIDENCE_LIMITS.cites);
}

/**
 * What a visual shows from the run: its images, the hunks of its code, its request, command, or
 * findings.
 */
function visualEvidence(
  v: Visual,
  index: EvidenceIndex,
  findings: ReadonlyArray<Pick<Finding, 'title' | 'evidenceIds'>>,
): string[] {
  const ids: string[] = [];
  const labelled = (kind: string, label: string) =>
    index.items
      .filter((i) => i.kind === kind && i.label === truncate(label, EVIDENCE_LIMITS.label))
      .map((i) => i.id);
  if (v.kind === 'code') {
    const lines = v.lines.flatMap((l) => (l.number === undefined ? [] : [l.number]));
    ids.push(
      ...hunksAt(index, {
        path: v.path,
        line: lines.length ? Math.min(...lines) : undefined,
        endLine: lines.length ? Math.max(...lines) : undefined,
      }),
    );
  } else if (v.kind === 'terminal') ids.push(...labelled('terminal', v.command));
  else if (v.kind === 'api') ids.push(...labelled('http', `${v.method} ${v.path}`));
  else if (v.kind === 'findings')
    // A finding may cite what the run no longer has; the scene cites only what it does.
    for (const card of v.findings)
      ids.push(
        ...(findings.find((f) => f.title === card.title)?.evidenceIds ?? []).filter((id) =>
          index.find(id),
        ),
      );
  const images = new Set(visualImages(v));
  ids.push(...index.items.filter((i) => images.has(i.path)).map((i) => i.id));
  return ids;
}

/** Scenes that cite ids the run's evidence does not have, as `scene <id>: <ids>` lines. */
export function unknownSceneEvidence(
  scenes: ReadonlyArray<Pick<Scene, 'id' | 'evidenceIds'>>,
  index: EvidenceIndex,
): string[] {
  return scenes.flatMap((s, i) => {
    const unknown = unknownCitations(index, s.evidenceIds);
    return unknown.length ? [`scene ${s.id ?? `s${i + 1}`}: ${unknown.join(', ')}`] : [];
  });
}

export interface GroundedScene {
  id: string;
  narration: string;
  kind: string;
  evidenceIds?: readonly string[];
}

/**
 * The `grounding` QC check: scenes that say something about the change and explanation statements
 * that cite no evidence. A warning, never a failure: grounding is the author's to fix.
 */
export function groundingCheck(
  scenes: readonly GroundedScene[],
  explanation?: Pick<Explanation, 'intent' | 'behavior' | 'changes'>,
): QcCheck {
  const bare = scenes
    .filter((s) => s.narration.trim() && !FRAMING.has(s.kind) && !s.evidenceIds?.length)
    .map((s) => s.id);
  const statements = explanation ? ungroundedStatements(explanation) : [];
  if (!bare.length && !statements.length)
    return {
      id: 'grounding',
      status: 'pass',
      message: 'Every scene and explanation statement cites evidence.',
    };
  const parts = [
    ...(bare.length ? [`scene ${bare.join(', ')}`] : []),
    ...(statements.length ? [`explanation ${statements.join(', ')}`] : []),
  ];
  return {
    id: 'grounding',
    status: 'warn',
    message: `Not grounded in the run's evidence: ${parts.join('; ')}. Cite evidenceIds (covi evidence --run <id>) or show a capture.`,
  };
}
