import { describe, expect, it } from 'vitest';
import { heroMoment } from '../src/sound.ts';
import type { TimelineScene } from '../src/timeline/types.ts';

const scene = (
  id: string,
  beat: string,
  start: number,
  end: number,
  extra: Partial<TimelineScene> = {},
) =>
  ({
    id,
    beat,
    eyebrow: beat,
    start,
    end,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    ...extra,
  }) as TimelineScene;

describe('the music hero moment', () => {
  it('lands on the hero once it has settled, preferring hero: true over the template beats', async () => {
    const scenes = [
      scene('s1', 'context', 0, 3),
      scene('s2', 'fix', 2.55, 6, { transition: { kind: 'fade', seconds: 0.45 } }),
      scene('s3', 'review', 5.4, 9, {
        hero: true,
        transition: { kind: 'zoom-through', seconds: 0.6 },
      }),
    ];
    expect(await heroMoment({ scenes }, 'bug-fix')).toBeCloseTo(6, 9);
    // Without a marked hero, the template's beats decide (bug-fix: proof, then fix).
    const unmarked = scenes.map(({ hero: _hero, ...s }) => s as TimelineScene);
    expect(await heroMoment({ scenes: unmarked }, 'bug-fix')).toBeCloseTo(3, 9);
    // Timelines written before per-scene transitions settle after the shared fade.
    expect(
      await heroMoment(
        { scenes: [scene('s1', 'context', 0, 3), scene('s2', 'fix', 2.55, 6)] },
        'bug-fix',
      ),
    ).toBeCloseTo(3, 9);
    expect(await heroMoment({ scenes: [scene('s1', 'context', 0, 3)] }, 'bug-fix')).toBeUndefined();
  });
});
