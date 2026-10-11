import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkill, methodologyOf, UsageError } from '@covi/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { DirectionSchema } from '../packages/video/src/direction/schema.ts';
import { FLOW_VERBS } from '../packages/video/src/timeline/types.ts';
import { covi } from './helpers/cli.ts';
import {
  directedTimeline,
  directionExample,
  readVideoRun,
  rewriteScenes,
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
    // The timeline draws them: the morph, the count, and the flow verbs play, and the metric is on
    // screen.
    const shots = timeline.scenes.flatMap((s) => (s.direction ? [s.direction] : []));
    const played = shots.flatMap((d) => d.beats.map((b) => b.verb));
    expect(played).toContain('morph');
    expect(played).toContain('count');
    expect(played.filter(flowing)).not.toEqual([]);
    expect(shots.flatMap((d) => d.elements.map((e) => e.kind))).toContain('metric');
    const checks = timelineChecks(timeline);
    expect(checks.map((c) => c.id)).toEqual([...TIMELINE_CHECKS]);
    for (const check of checks) expect(check, check.message).toMatchObject({ status: 'pass' });
  });
});

/**
 * English number words: the example's labels hold none. A label's schema refuses digits, but it
 * cannot tell a number word from any other word, so the example has to practise the rule itself.
 */
const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen)\b/i;

describe('the direction method’s worked example', () => {
  it('directs the benchmark as written: every id, kind, side, and phrase fits, and every check of its timeline passes', async () => {
    const example = directionExample();
    const authored = DirectionSchema.parse(example.direction);
    const storyboard = rewriteScenes(drafted.storyboard, example.scenes);
    const { plan, timeline } = await directedTimeline(
      { ...drafted, storyboard },
      example.direction,
    );
    // The agent's shots stand as written; Covi directs only the summary it left out.
    expect(plan.draft).toBe(false);
    expect(plan.shots.slice(0, authored.shots.length)).toEqual(authored.shots);
    expect(plan.shots.map((s) => s.scene)).toEqual(['s1', 's2', 's3', 's4']);
    // It stages the change with what the method teaches: a morph, a measured count, flow verbs,
    // and the timeout as a warning on the scene that cites the measured timeout.
    const elements = authored.shots.flatMap((s) => s.elements);
    expect(elements.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['node', 'packet', 'label', 'morph', 'metric']),
    );
    expect(authored.shots.flatMap((s) => s.beats.map((b) => b.verb))).toEqual(
      expect.arrayContaining(['reveal', 'flow', 'split', 'camera', 'morph', 'merge', 'count']),
    );
    expect(authored.shots.find((s) => s.scene === 's1')!.elements).toContainEqual(
      expect.objectContaining({ kind: 'label', tone: 'warning' }),
    );
    expect(storyboard.scenes.find((s) => s.id === 's1')!.evidenceIds).toEqual([
      'metric:terminal-1:timeouts',
    ]);
    // Every beat plays, in the order written, and the timeline passes every check it can.
    for (const shot of authored.shots)
      expect(
        timeline.scenes.find((s) => s.id === shot.scene)!.direction!.beats.map((b) => b.verb),
        shot.scene,
      ).toEqual(shot.beats.map((b) => b.verb));
    const checks = timelineChecks(timeline);
    expect(checks.map((c) => c.id)).toEqual([...TIMELINE_CHECKS]);
    for (const check of checks) expect(check, check.message).toMatchObject({ status: 'pass' });
  });

  it('practises what it teaches: short labels without numbers, the entrances Variety teaches, a phrase for every beat', () => {
    const { shots } = DirectionSchema.parse(directionExample().direction);
    for (const shot of shots) {
      expect(shot.elements.length, shot.scene).toBeLessThanOrEqual(4);
      expect(shot.beats.length, shot.scene).toBeLessThanOrEqual(4);
      if (shot.enter)
        expect(['pan', 'zoom', 'wipe', 'cut', 'push'], shot.scene).toContain(shot.enter);
      for (const beat of shot.beats) expect(beat, shot.scene).toHaveProperty('at');
      for (const element of shot.elements) {
        const words =
          'label' in element ? element.label : 'text' in element ? element.text : undefined;
        if (words !== undefined)
          expect(words, `${shot.scene}: ${element.id}`).not.toMatch(NUMBER_WORDS);
      }
    }
  });

  it('is refused, naming the shot and the beat, once a line no longer says a phrase its beats quote', async () => {
    const example = directionExample();
    const scenes = example.scenes.map((s) =>
      s.id === 's3' ? { ...s, narration: 'Those four chunks are now [[one request]].' } : s,
    );
    const storyboard = rewriteScenes(drafted.storyboard, scenes);
    const refused = directedTimeline({ ...drafted, storyboard }, example.direction);
    // The usage error `covi render` exits 2 with, not an internal one.
    await expect(refused).rejects.toBeInstanceOf(UsageError);
    await expect(refused).rejects.toThrow(
      /shot 3 \(scene s3\), beat 3 \(count\) quotes "ten thousand"/,
    );
  });
});

/**
 * The most words the covi-video methodology may carry into the narration prompt. Every narration
 * refinement sends it as the system prompt (`refineNarration`), so each word it gains is paid on
 * every run and crowds the change's own material out of the model's budget.
 */
const PROMPT_WORDS = 2800;

describe('the covi-video methodology in model prompts', () => {
  it('carries direction as one short rule, leaving the verb reference and the draft loop to agents', async () => {
    const methodology = methodologyOf(await loadSkill('covi-video'));
    expect(methodology).toContain('**Direct the picture.**');
    expect(methodology).toContain('references/direction.md');
    for (const term of [
      '--draft',
      '--direction',
      'video/draft',
      'covi render',
      'count-up',
      'qc.json',
    ])
      expect(methodology, term).not.toContain(term);
    expect(methodology.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(PROMPT_WORDS);
  });
});
