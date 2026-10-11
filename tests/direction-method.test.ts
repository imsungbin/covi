import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { DirectionSchema } from '../packages/video/src/direction/schema.ts';
import { FLOW_VERBS } from '../packages/video/src/timeline/types.ts';
import { covi } from './helpers/cli.ts';
import {
  directedTimeline,
  readVideoRun,
  TIMELINE_CHECKS,
  timelineChecks,
  type VideoRun,
} from './helpers/direction.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const flowing = (verb: string) => (FLOW_VERBS as readonly string[]).includes(verb);

/** The benchmark as `covi video --standard --draft` leaves it for an agent to direct. */
let drafted: VideoRun;
beforeAll(async () => {
  const example = (await listExamples()).find((e) => e.name === 'backend-slim-request')!;
  const repo = await materializeExample(example);
  dirs.push(repo);
  const result = covi(['video', '--repo', repo, '--standard', '--draft', '--force', '--json']);
  expect(result.code, result.stderr).toBe(0);
  drafted = await readVideoRun((result.json() as { runDir: string }).runDir, repo);
}, 300_000);

describe('the benchmark’s default direction', () => {
  it('morphs its code, counts its key number, stages its counts with flow verbs, and passes every check of its timeline', async () => {
    const { plan, timeline } = await directedTimeline(drafted);
    // What `covi video --draft` wrote for the agent is what Covi directs when nobody rewrites it.
    const written = JSON.parse(
      readFileSync(join(drafted.runDir, 'video', 'direction.json'), 'utf8'),
    ) as unknown;
    expect(plan).toEqual(DirectionSchema.parse(written));
    const kinds = plan.shots.flatMap((s) => s.elements.map((e) => e.kind));
    expect(kinds).toContain('morph');
    expect(kinds).toContain('metric');
    expect(plan.shots.flatMap((s) => s.beats.map((b) => b.verb)).filter(flowing)).not.toEqual([]);
    // The timeline draws them: the morph and the flow verbs play, and the metric is on screen.
    const shots = timeline.scenes.flatMap((s) => (s.direction ? [s.direction] : []));
    const played = shots.flatMap((d) => d.beats.map((b) => b.verb));
    expect(played).toContain('morph');
    expect(played.filter(flowing)).not.toEqual([]);
    expect(shots.flatMap((d) => d.elements.map((e) => e.kind))).toContain('metric');
    const checks = timelineChecks(timeline);
    expect(checks.map((c) => c.id)).toEqual([...TIMELINE_CHECKS]);
    for (const check of checks) expect(check, check.message).toMatchObject({ status: 'pass' });
  });
});
