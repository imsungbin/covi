import { indexEvidence, UsageError } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { planDirection } from '../src/direction/plan.ts';
import { DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';

const scene = (id: string, narration: string): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual: { kind: 'callout', title: 'C' } });
// The storyboard as the agent wrote it, and as redaction left it for drawing.
const authored = [
  scene('s1', 'It sent every document.'),
  scene('s2', 'Now it sends the ids of hunter2.'),
  scene('s3', 'Done.'),
];
const drawn = authored.map((s) => ({
  ...s,
  narration: s.narration.replace('hunter2', '[REDACTED]'),
}));
const evidence = indexEvidence({ items: [] });
const base = {
  authored,
  scenes: drawn,
  evidence,
  sources: directionSources({ evidence }),
  seed: 2,
};

describe('planning the direction', () => {
  it('renders as 0.2.0 did when direction is off: no shots, no entrances, nothing read', () => {
    const file = DirectionSchema.parse({
      shots: [{ scene: 'nope', elements: [{ id: 'v', kind: 'visual' }] }],
    });
    expect(planDirection({ ...base, mode: 'off', file })).toEqual({ entrances: new Map() });
  });

  it('directs every scene by default, and drafts that direction for the agent', () => {
    const planned = planDirection({ ...base, mode: 'auto' });
    expect(planned.draft).toMatchObject({ schemaVersion: 1, draft: true });
    expect(planned.plan).toBe(planned.draft);
    expect([...planned.entrances.keys()]).toEqual(['s2', 's3']);
  });

  it('puts the agent’s shots over Covi’s, checking phrases against the line as written', () => {
    const file = DirectionSchema.parse({
      shots: [
        {
          scene: 's2',
          enter: 'zoom',
          elements: [{ id: 'note', kind: 'label', text: 'Ids only' }],
          beats: [{ verb: 'reveal', element: 'note', at: 'the ids of hunter2' }],
        },
      ],
    });
    const planned = planDirection({ ...base, mode: 'auto', file });
    expect(planned.plan!.draft).toBe(false);
    expect(planned.plan!.shots).toHaveLength(3);
    expect(planned.plan!.shots.find((s) => s.scene === 's2')).toEqual(file.shots[0]);
    expect(planned.entrances.get('s2')).toBe('zoom');
  });

  it('refuses an agent’s direction that does not fit the run, listing every problem (exit 2)', () => {
    const file = DirectionSchema.parse({
      shots: [
        { scene: 's9', elements: [{ id: 'v', kind: 'visual' }] },
        { scene: 's2', elements: [{ id: 'c', kind: 'capture', evidence: 'screenshot:none' }] },
      ],
    });
    let error: unknown;
    try {
      planDirection({ ...base, mode: 'auto', file });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).exitCode).toBe(2);
    expect((error as Error).message).toMatch(
      /^video\/direction\.json does not fit this run:\n {2}shot 1 \(scene s9\)[^\n]*\n {2}shot 2 \(scene s2\), element c/,
    );
  });

  it('ignores a stale draft: a rewritten storyboard never fails on Covi’s own direction', () => {
    const stale = DirectionSchema.parse({
      draft: true,
      shots: [{ scene: 'gone', elements: [{ id: 'v', kind: 'visual' }] }],
    });
    const planned = planDirection({ ...base, mode: 'auto', file: stale });
    expect(planned.plan!.shots.map((s) => s.scene)).toEqual(['s1', 's2', 's3']);
    expect(planned.plan!.draft).toBe(true);
  });
});
