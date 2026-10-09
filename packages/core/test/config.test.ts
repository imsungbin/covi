import { describe, expect, it } from 'vitest';
import { parseYamlConfig } from '../src/config/load.ts';
import { configFromEnv, parseConfigInput, resolveConfig } from '../src/config/resolve.ts';
import { DEFAULT_CONFIG } from '../src/config/schema.ts';

describe('configuration', () => {
  it('uses global defaults when nothing is configured', () => {
    const { config, provenance } = resolveConfig([]);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(provenance['video.mode']).toBe('global');
  });

  it('applies precedence explicit > repository > workflow > global regardless of input order', () => {
    const { config, provenance } = resolveConfig([
      {
        name: 'explicit',
        source: '--duration',
        values: parseConfigInput({ video: { duration: '30s' } }, 'flags'),
      },
      {
        name: 'workflow',
        source: 'ci',
        values: parseConfigInput(
          { video: { mode: 'standard', duration: 90 }, publish: { comment: false } },
          'wf',
        ),
      },
      {
        name: 'repository',
        source: '.covi/config.yml',
        values: parseConfigInput({ video: { mode: 'short', theme: 'dark' } }, 'repo'),
      },
    ]);
    expect(config.video.mode).toBe('short');
    expect(config.video.duration).toBe(30);
    expect(config.video.theme).toBe('dark');
    expect(config.publish.comment).toBe(false);
    expect(config.video.fps).toBe(30);
    expect(provenance).toMatchObject({
      'video.mode': 'repository (.covi/config.yml)',
      'video.duration': 'explicit (--duration)',
      'publish.comment': 'workflow (ci)',
      'video.fps': 'global',
    });
  });

  it('normalizes narration booleans and merges narration objects', () => {
    const { config } = resolveConfig([
      {
        name: 'repository',
        values: parseConfigInput({ video: { narration: { voice: 'Samantha' } } }, 'repo'),
      },
      { name: 'explicit', values: parseConfigInput({ video: { narration: false } }, 'flags') },
    ]);
    expect(config.video.narration).toEqual({
      enabled: false,
      provider: 'auto',
      rate: 1,
      voice: 'Samantha',
    });
  });

  it('parses durations in human formats', () => {
    expect(
      parseConfigInput({ app: { timeout: '1m30s' }, test: { timeout: 45 } }, 'x'),
    ).toMatchObject({ app: { timeout: 90 }, test: { timeout: 45 } });
  });

  it('rejects typos and invalid values with actionable messages', () => {
    expect(() => parseYamlConfig('video:\n  mdoe: short\n', '.covi/config.yml')).toThrow(
      /video: unknown key\(s\): mdoe/,
    );
    expect(() => parseYamlConfig('video:\n  mode: vertical\n', '.covi/config.yml')).toThrow(
      /video\.mode: expected one of "short", "standard", "custom"/,
    );
    expect(() => parseYamlConfig('app:\n  timeout: soon\n', 'cfg')).toThrow(/Invalid duration/);
    expect(() => parseYamlConfig('a: [', 'cfg')).toThrow(/not valid YAML/);
  });

  it('accepts demo flows with one action per step', () => {
    const parsed = parseYamlConfig(
      [
        'demo:',
        '  flows:',
        '    - name: Post a comment',
        '      path: /posts/1',
        '      steps:',
        '        - fill: textarea',
        '          text: Hi',
        '        - click: "text=Post"',
        '        - screenshot: posted',
      ].join('\n'),
      'cfg',
    );
    expect(parsed.demo?.flows?.[0]?.steps).toHaveLength(3);
    expect(() =>
      parseYamlConfig(
        'demo:\n  flows:\n    - name: x\n      steps:\n        - click: a\n          fill: b\n',
        'cfg',
      ),
    ).toThrow();
  });

  it('maps COVI_* environment variables to explicit config', () => {
    const env = configFromEnv({
      COVI_VIDEO_MODE: 'standard',
      COVI_NARRATION: 'false',
      COVI_TTS_VOICE: 'Reed',
      COVI_FAIL_ON: 'high',
    });
    expect(env).toMatchObject({
      video: { mode: 'standard', narration: { enabled: false, voice: 'Reed' } },
      review: { failOn: 'high' },
    });
    // Choosing a voice does not turn narration back on.
    const { config } = resolveConfig([{ name: 'explicit', values: env }]);
    expect(config.video.narration).toMatchObject({ enabled: false, voice: 'Reed' });
  });

  it('records browser flows by default; demo.record and COVI_DEMO_RECORD turn it off', () => {
    expect(resolveConfig([]).config.demo.record).toBe(true);
    const repo = resolveConfig([
      {
        name: 'repository',
        source: '.covi/config.yml',
        values: parseConfigInput({ demo: { record: false } }, 't'),
      },
    ]);
    expect(repo.config.demo.record).toBe(false);
    expect(repo.provenance['demo.record']).toBe('repository (.covi/config.yml)');
    expect(configFromEnv({ COVI_DEMO_RECORD: '0' }).demo?.record).toBe(false);
    expect(configFromEnv({ COVI_DEMO_RECORD: 'yes' }).demo?.record).toBe(true);
    expect(() => parseConfigInput({ demo: { record: 'yes' } }, 't')).toThrow(/demo\.record/);
  });

  it('keeps the subject model in the repository by default and checks its keys', () => {
    expect(DEFAULT_CONFIG.subject).toEqual({ store: 'repo', expireAfter: 20 });
    const { config, provenance } = resolveConfig([
      {
        name: 'repository',
        source: '.covi/config.yml',
        values: parseConfigInput({ subject: { store: 'runs', expireAfter: 5 } }, 't'),
      },
    ]);
    expect(config.subject).toEqual({ store: 'runs', expireAfter: 5 });
    expect(provenance['subject.store']).toBe('repository (.covi/config.yml)');
    for (const subject of [
      { store: 'nowhere' },
      { expireAfter: 0 },
      { expireAfter: 101 },
      { keep: true },
    ])
      expect(() => parseConfigInput({ subject }, '.covi/config.yml')).toThrow(
        /\.covi\/config\.yml is invalid/,
      );
  });

  it('keeps anchors off, the rating line on, and calibration on unless configured', () => {
    expect(DEFAULT_CONFIG.publish).toEqual({
      comment: true,
      annotations: true,
      video: 'link',
      anchors: false,
      rating: true,
      botLogin: 'github-actions[bot]',
    });
    const { config } = resolveConfig([
      {
        name: 'repository',
        values: parseConfigInput(
          { publish: { anchors: true, rating: false }, review: { calibration: false } },
          'test',
        ),
      },
    ]);
    expect(config.publish).toMatchObject({ anchors: true, rating: false });
    expect(config.review.calibration).toBe(false);
  });

  it('takes a GitHub App bot login for publish.botLogin, and nothing else', () => {
    expect(
      parseConfigInput({ publish: { botLogin: 'covi-app[bot]' } }, 't').publish?.botLogin,
    ).toBe('covi-app[bot]');
    for (const botLogin of ['octocat', 'some app[bot]', '[bot]', 'x[bot] '])
      expect(() => parseConfigInput({ publish: { botLogin } }, 't')).toThrow(/publish\.botLogin/);
  });

  it('takes a GitLab username for publish.gitlabBotUser, with no default', () => {
    expect(DEFAULT_CONFIG.publish.gitlabBotUser).toBeUndefined();
    for (const user of ['project_5_bot_covi', 'group_12_bot_9f3a', 'covi.bot-1'])
      expect(
        parseConfigInput({ publish: { gitlabBotUser: user } }, 't').publish?.gitlabBotUser,
      ).toBe(user);
    for (const gitlabBotUser of ['', 'covi[bot]', 'some user', '-covi', 'covi.', 'a/b'])
      expect(() => parseConfigInput({ publish: { gitlabBotUser } }, 't')).toThrow(
        /publish\.gitlabBotUser/,
      );
  });
});

describe('music and sound effects', () => {
  it('default to the Covi theme with sound effects on', () => {
    const { config, provenance } = resolveConfig([]);
    expect(config.video.music).toEqual({ use: 'theme', placement: 'auto' });
    expect(config.video.soundEffects).toEqual({ enabled: true });
    expect(config.video.outro).toBe(true);
    expect(provenance['video.music.use']).toBe('global');
    expect(provenance['video.music.placement']).toBe('global');
    expect(provenance['video.outro']).toBe('global');
    expect(provenance['video.soundEffects.enabled']).toBe('global');
  });

  it('reads both from the repository file with provenance', () => {
    const parsed = parseYamlConfig(
      'video:\n  music:\n    use: compose\n  soundEffects:\n    enabled: false\n',
      '.covi/config.yml',
    );
    const { config, provenance } = resolveConfig([
      { name: 'repository', source: '.covi/config.yml', values: parsed },
    ]);
    expect(config.video.music.use).toBe('compose');
    expect(config.video.soundEffects.enabled).toBe(false);
    expect(provenance['video.music.use']).toBe('repository (.covi/config.yml)');
    expect(provenance['video.soundEffects.enabled']).toBe('repository (.covi/config.yml)');
  });

  it('maps COVI_MUSIC and COVI_SOUND_EFFECTS to explicit configuration', () => {
    const env = configFromEnv({ COVI_MUSIC: 'none', COVI_SOUND_EFFECTS: 'false' });
    expect(env).toMatchObject({
      video: { music: { use: 'none' }, soundEffects: { enabled: false } },
    });
    const { config, provenance } = resolveConfig([
      {
        name: 'repository',
        values: parseConfigInput({ video: { music: { use: 'compose' } } }, 'r'),
      },
      { name: 'explicit', source: 'COVI_* environment', values: env },
    ]);
    expect(config.video.music.use).toBe('none');
    expect(config.video.soundEffects.enabled).toBe(false);
    expect(provenance['video.music.use']).toBe('explicit (COVI_* environment)');
    expect(configFromEnv({ COVI_SOUND_EFFECTS: 'on' }).video?.soundEffects?.enabled).toBe(true);
  });

  it('reads where the music plays and the outro, from the file and from COVI_*', () => {
    const parsed = parseYamlConfig(
      'video:\n  music:\n    placement: continuous\n  outro: false\n',
      '.covi/config.yml',
    );
    const { config, provenance } = resolveConfig([
      { name: 'repository', source: '.covi/config.yml', values: parsed },
    ]);
    // The placement joins the music section without disturbing the music choice.
    expect(config.video.music).toEqual({ use: 'theme', placement: 'continuous' });
    expect(config.video.outro).toBe(false);
    expect(provenance['video.music.placement']).toBe('repository (.covi/config.yml)');
    expect(provenance['video.music.use']).toBe('global');
    expect(
      configFromEnv({ COVI_MUSIC: 'compose', COVI_MUSIC_PLACEMENT: 'bookends', COVI_OUTRO: 'off' }),
    ).toMatchObject({ video: { music: { use: 'compose', placement: 'bookends' }, outro: false } });
    expect(configFromEnv({ COVI_OUTRO: 'yes' }).video?.outro).toBe(true);
    expect(() => configFromEnv({ COVI_MUSIC_PLACEMENT: 'everywhere' })).toThrow(
      /video\.music\.placement: expected one of "auto", "continuous", "bookends"/,
    );
  });

  it('rejects unknown music choices and scalar shorthands', () => {
    expect(() => configFromEnv({ COVI_MUSIC: 'jazz' })).toThrow(
      /video\.music\.use: expected one of "theme", "compose", "none"/,
    );
    expect(() => parseYamlConfig('video:\n  music: none\n', 'cfg')).toThrow(/video\.music/);
    expect(() => parseYamlConfig('video:\n  soundEffects: false\n', 'cfg')).toThrow(
      /video\.soundEffects/,
    );
  });
});

describe('video direction', () => {
  it('directs on the canvas by default; the file, COVI_VIDEO_DIRECTION, and flags can turn it off', () => {
    const { config, provenance } = resolveConfig([]);
    expect(config.video.direction).toBe('auto');
    expect(provenance['video.direction']).toBe('global');
    // YAML 1.2: an unquoted `off` is the string, not false.
    const parsed = parseYamlConfig('video:\n  direction: off\n', '.covi/config.yml');
    const repo = resolveConfig([
      { name: 'repository', source: '.covi/config.yml', values: parsed },
    ]);
    expect(repo.config.video.direction).toBe('off');
    expect(repo.provenance['video.direction']).toBe('repository (.covi/config.yml)');
    expect(configFromEnv({ COVI_VIDEO_DIRECTION: 'off' })).toMatchObject({
      video: { direction: 'off' },
    });
    expect(() => configFromEnv({ COVI_VIDEO_DIRECTION: 'sometimes' })).toThrow(
      /video\.direction: expected one of "auto", "off"/,
    );
  });
});

describe('YAML config edge cases', () => {
  it('treats sections with only commented-out keys as absent', () => {
    expect(parseYamlConfig('test:\n  # command: npm test\nvideo:\n  mode: short\n', 'cfg')).toEqual(
      { video: { mode: 'short' } },
    );
  });
});
