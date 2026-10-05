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
});

describe('YAML config edge cases', () => {
  it('treats sections with only commented-out keys as absent', () => {
    expect(parseYamlConfig('test:\n  # command: npm test\nvideo:\n  mode: short\n', 'cfg')).toEqual(
      { video: { mode: 'short' } },
    );
  });
});
