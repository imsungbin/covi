import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildReview,
  explainHeuristically,
  Git,
  type Language,
  loadRepositoryConfig,
  renderComment,
  renderExplanation,
  renderReview,
  resolveChange,
  resolveConfig,
  runRules,
  understandChange,
} from '@covi/core';
import {
  draftStoryboard,
  loadTemplates,
  normalizeSpeech,
  parseVideoRequest,
  planVideo,
  resolveVideoSpec,
  StoryboardSchema,
  speakScenes,
  timelineLabels,
} from '@covi/video';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { covi } from './helpers/cli.ts';
import { createRepo, type TempRepo } from './helpers/repo.ts';

const HANGUL = /\p{Script=Hangul}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;
const SCRIPT: Record<Exclude<Language, 'en'>, RegExp> = { ko: HANGUL, ja: KANA, zh: HAN };

const repos: TempRepo[] = [];
const dirs: string[] = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A small CLI change described in Korean, with acronyms in the description and commits. */
function koreanCliRepo(): TempRepo {
  const repo = createRepo({
    'package.json': '{ "name": "c2-delegate", "bin": { "c2-delegate": "bin/cli.js" } }\n',
    'bin/cli.js': "#!/usr/bin/env node\nconsole.log('hello');\n",
  });
  repo.git('checkout', '-q', '-b', 'feat/cli');
  repo.commit('feat(cli): c2-delegate CLI를 추가하고 JSON 출력을 지원합니다', {
    'bin/cli.js':
      "#!/usr/bin/env node\nconst json = process.argv.includes('--json');\nconst result = { ok: true };\nconsole.log(json ? JSON.stringify(result) : 'ok');\n",
    'src/delegate.js':
      'export function delegate(task) {\n  return { task, status: "queued" };\n}\n',
  });
  repos.push(repo);
  return repo;
}

async function analyze(dir: string, language: Language) {
  const loaded = await loadRepositoryConfig(dir, { kind: 'worktree' });
  const { config } = resolveConfig(
    loaded.values ? [{ name: 'repository', values: loaded.values }] : [],
  );
  const git = new Git(dir);
  const change = await resolveChange({ repo: dir, ignore: config.ignore });
  const context = await understandChange(change, { git, config, language });
  const rules = await runRules(change, context, { git, config, language });
  const { review } = buildReview({
    ruleFindings: rules.findings,
    checked: rules.checked,
    config,
    context,
    generatedBy: { provider: 'heuristic' },
    language,
  });
  return { config, change, context, review, explanation: explainHeuristically(context, language) };
}

describe('a change described in Korean', () => {
  it('runs in Korean on its own and records why (auto)', () => {
    const repo = koreanCliRepo();
    const result = covi(['explain', '--repo', repo.root, '--json']);
    expect(result.code, result.stderr).toBe(0);
    const { runDir } = result.json() as { runDir: string };
    const manifest = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    expect(manifest.language).toMatchObject({ value: 'ko', setting: 'auto' });
    expect(manifest.language.source).toMatch(/Hangul/);
    expect(readFileSync(join(runDir, 'explanation.md'), 'utf8')).toMatch(/## 변경 내용/);
  });

  it('drafts a Korean storyboard whose voice says 씨엘아이 and 제이슨 (drafted)', async () => {
    const repo = koreanCliRepo();
    const { config, change, context, review, explanation } = await analyze(repo.root, 'ko');
    const storyboard = draftStoryboard({
      change,
      context,
      explanation,
      review,
      spec: resolveVideoSpec(config, { mode: 'standard' }),
      templates: await loadTemplates(),
      language: 'ko',
    });
    expect(StoryboardSchema.safeParse(storyboard).success).toBe(true);
    expect(storyboard.language).toBe('ko');
    const spoken = speakScenes(storyboard.scenes, { language: 'ko' })
      .map((s) => s.spoken)
      .join(' ');
    expect(storyboard.scenes.map((s) => s.narration).join(' ')).toMatch(/CLI를/);
    expect(spoken).toContain('씨엘아이를');
    expect(spoken).toContain('제이슨');
    expect(spoken).not.toMatch(/\bCLI\b|\bJSON\b/);
  });
});

describe('heuristic output in every language', () => {
  const cases = ['api-users-pagination', 'ui-comment-composer'] as const;
  for (const name of cases) {
    for (const language of ['ko', 'ja', 'zh'] as const) {
      it(`writes ${name} in ${language}: explanation, review, comment, and draft`, async () => {
        const example = (await listExamples()).find((e) => e.name === name)!;
        const dir = await materializeExample(example);
        dirs.push(dir);
        const { config, change, context, review, explanation } = await analyze(dir, language);
        const script = SCRIPT[language];

        expect(explanation.language).toBe(language);
        expect(explanation.summary).toMatch(script);
        for (const c of explanation.changes) expect(c.description).toMatch(script);
        const md = renderExplanation(explanation, context);
        expect(md).not.toMatch(
          /## (What changed|Before you read the diff|Suggested reading order)/,
        );
        expect(renderReview(review, explanation, context)).not.toMatch(/^# Review:/m);
        expect(renderComment(review, explanation, context)).not.toMatch(/Covi review:/);
        for (const f of review.findings) expect(f.title, f.title).toMatch(script);

        const storyboard = draftStoryboard({
          change,
          context,
          explanation,
          review,
          spec: resolveVideoSpec(config, { mode: 'short' }),
          templates: await loadTemplates(),
          language,
        });
        expect(StoryboardSchema.safeParse(storyboard).success).toBe(true);
        // Short labels can be all kanji in Japanese (互換性); sentences always carry kana.
        const label =
          language === 'ja' ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u : script;
        for (const scene of storyboard.scenes) {
          expect(scene.eyebrow, scene.beat).toMatch(label);
          expect(scene.narration, scene.beat).toMatch(script);
          const { eyebrow } = scene.visual as { eyebrow?: string };
          if (eyebrow) expect(eyebrow, `${scene.beat} title card`).toMatch(label);
        }
        const labels = timelineLabels(language);
        expect(labels.verdict['looks-good']).toMatch(label);
        expect(labels.stats.files).toMatch(label);
      });
    }
  }
});

describe('video requests in Korean, Japanese, and Chinese', () => {
  it.each([
    ['30초짜리 세로 리뷰 영상', { mode: 'short', duration: 30 }],
    ['1분 30초 가로 영상, 내레이션 없이', { mode: 'standard', duration: 90, narration: false }],
    ['자막 없이 다크 모드로', { captions: false, theme: 'dark' }],
    ['30秒の縦動画、ナレーションなし', { mode: 'short', duration: 30, narration: false }],
    ['日本語で1分半の横長の動画', { mode: 'standard', duration: 90, language: 'ja' }],
    [
      '做一个30秒竖屏视频，无旁白，用中文',
      { mode: 'short', duration: 30, narration: false, language: 'zh' },
    ],
    [
      '2分钟横屏视频 无字幕 深色',
      { mode: 'standard', duration: 120, captions: false, theme: 'dark' },
    ],
    ['Make a 45-second Korean video', { mode: 'short', duration: 45, language: 'ko' }],
  ])('reads "%s"', (text, expected) => {
    expect(parseVideoRequest(text).request).toMatchObject(expected);
  });

  it('does not take a language from a passing mention', () => {
    expect(parseVideoRequest('review the Korean locale change').request.language).toBeUndefined();
  });

  it('asks its questions in the language of the request or the run', () => {
    const config = resolveConfig([]).config;
    const korean = planVideo(config, { text: '리뷰 영상 만들어줘', interactive: true });
    expect(korean.questions[0]!.question).toMatch(HANGUL);
    const japanese = planVideo(config, { interactive: true, language: 'ja' });
    expect(japanese.questions.map((q) => q.header)).toEqual(['動画の種類', '長さ']);
    const english = planVideo(config, { interactive: true });
    expect(english.questions[0]!.question).toBe('What kind of video should Covi create?');
  });
});

describe('agent-authored storyboards', () => {
  it('normalize Korean narration with particles attached (agent-authored)', () => {
    const scenes = [
      { id: 's1', narration: 'c2-delegate CLI를 추가합니다.' },
      { id: 's2', narration: 'JSON 응답과 API는 그대로입니다.' },
    ];
    expect(speakScenes(scenes, { language: 'ko' }).map((s) => s.spoken)).toEqual([
      'c2-delegate 씨엘아이를 추가합니다.',
      '제이슨 응답과 에이피아이는 그대로입니다.',
    ]);
    expect(
      normalizeSpeech('c2-delegate CLI를', {
        language: 'ko',
        pronunciations: { c2: { ko: '씨투' } },
      }).text,
    ).toBe('씨투-delegate 씨엘아이를');
  });
});
