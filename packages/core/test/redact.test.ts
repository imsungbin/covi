import { describe, expect, it } from 'vitest';
import { childEnv } from '../src/security/env.ts';
import { findSecrets, Redactor } from '../src/security/redact.ts';

describe('Redactor', () => {
  it('masks secret values present in the environment', () => {
    const redactor = new Redactor({
      env: { GITHUB_TOKEN: 'abcdef1234567890', PATH: '/usr/bin', DEBUG: 'true' },
    });
    expect(redactor.redact('token=abcdef1234567890 path=/usr/bin')).toBe(
      'token=[REDACTED] path=/usr/bin',
    );
  });

  it('masks well-known token formats while keeping a recognizable prefix', () => {
    const r = new Redactor();
    const github = `ghp_${'a'.repeat(36)}`;
    expect(r.redact(`use ${github}`)).toBe('use ghp_[REDACTED]');
    expect(r.redact(`key sk-ant-${'x1'.repeat(20)}`)).toContain('[REDACTED]');
    // Assembled at runtime, so this file holds nothing a secret scanner (or Covi) would flag.
    const pem = (edge: string) => `-----${edge} RSA PRIVATE ${'KEY'}-----`;
    expect(r.redact(['AKIA', 'ABCDEFGHIJKLMNOP'].join(''))).toBe('AKIA[REDACTED]');
    expect(r.redact(`${pem('BEGIN')}\nMIIE\n${pem('END')}`)).toBe('[REDACTED]');
  });

  it('removes credentials from URLs and quoted assignments', () => {
    const r = new Redactor();
    expect(r.redact('https://user:s3cret@example.com/repo.git')).toBe(
      'https://[REDACTED]@example.com/repo.git',
    );
    expect(r.redact('password: "hunter2hunter2"')).toBe('password: "[REDACTED]"');
  });

  it('redacts nested JSON values', () => {
    const r = new Redactor({ literals: ['super-secret-value'] });
    expect(r.redactDeep({ a: ['x super-secret-value'], b: { c: 1 } })).toEqual({
      a: ['x [REDACTED]'],
      b: { c: 1 },
    });
  });

  it('finds secrets but ignores obvious placeholders', () => {
    expect(findSecrets(`const t = "ghp_${'Z'.repeat(36)}";`)).toHaveLength(1);
    expect(findSecrets(`AWS_ACCESS_KEY_ID=AKIA${'X'.repeat(16)}`)).toHaveLength(0);
  });
});

describe('childEnv', () => {
  it('passes only safe variables to project commands', () => {
    const env = childEnv({
      source: {
        PATH: '/bin',
        HOME: '/home/u',
        GITHUB_TOKEN: 't',
        AWS_SECRET_ACCESS_KEY: 's',
        NPM_TOKEN: 'n',
        LANG: 'C',
        LC_ALL: 'C',
      },
      extra: { FEATURE_FLAG: '1' },
    });
    expect(env).toMatchObject({
      PATH: '/bin',
      HOME: '/home/u',
      LANG: 'C',
      LC_ALL: 'C',
      FEATURE_FLAG: '1',
      CI: '1',
    });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
  });

  it('allows explicit pass-through', () => {
    expect(childEnv({ source: { NPM_TOKEN: 'n' }, passThrough: ['NPM_TOKEN'] }).NPM_TOKEN).toBe(
      'n',
    );
  });
});
