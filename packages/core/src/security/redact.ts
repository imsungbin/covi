/**
 * Secret redaction. Every artifact, log line, and command record Covi writes passes through a
 * Redactor so that tokens present in the environment (CI secrets) or in the diff itself never
 * leak into run outputs, PR/MR comments, model prompts, or rendered videos.
 */

export interface SecretPattern {
  id: string;
  label: string;
  regex: RegExp;
  /** Characters of the match kept visible to help humans recognise what was masked. */
  keepPrefix?: number;
  /** Replace only this capture group (1-based) instead of the whole match. */
  group?: number;
}

/** High-confidence token formats. Used for redaction and by the `secret-in-diff` review rule. */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: 'private-key',
    label: 'private key',
    regex:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,
  },
  {
    id: 'github-token',
    label: 'GitHub token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    keepPrefix: 4,
  },
  {
    id: 'github-pat',
    label: 'GitHub token',
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    keepPrefix: 11,
  },
  {
    id: 'gitlab-token',
    label: 'GitLab token',
    regex: /\bgl(?:pat|ptt|dt|rt|cbt|imt|ffct|oas|soat|agent)-[A-Za-z0-9_-]{20,}\b/g,
    keepPrefix: 6,
  },
  {
    id: 'anthropic-key',
    label: 'Anthropic API key',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    keepPrefix: 7,
  },
  {
    id: 'openai-key',
    label: 'OpenAI API key',
    regex: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
    keepPrefix: 3,
  },
  {
    id: 'aws-access-key-id',
    label: 'AWS access key id',
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/g,
    keepPrefix: 4,
  },
  {
    id: 'aws-secret-access-key',
    label: 'AWS secret access key',
    regex: /(aws_secret_access_key["']?\s*[:=]\s*["']?)([A-Za-z0-9/+=]{40})/gi,
    group: 2,
  },
  {
    id: 'slack-token',
    label: 'Slack token',
    regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
    keepPrefix: 5,
  },
  {
    id: 'slack-webhook',
    label: 'Slack webhook URL',
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/g,
    keepPrefix: 32,
  },
  { id: 'stripe-key', label: 'Stripe key', regex: /\b[sr]k_live_[A-Za-z0-9]{16,}/g, keepPrefix: 8 },
  {
    id: 'google-api-key',
    label: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    keepPrefix: 4,
  },
  { id: 'npm-token', label: 'npm token', regex: /\bnpm_[A-Za-z0-9]{36}\b/g, keepPrefix: 4 },
  {
    id: 'jwt',
    label: 'JSON Web Token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    keepPrefix: 3,
  },
];

/** Credential-shaped assignments; redacted in outputs but too noisy to report as findings. */
const ASSIGNMENT_PATTERN =
  /(\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\b["']?\s*[:=]\s*["'])([^"'\s$<>{}]{8,})(["'])/gi;

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

/**
 * Query and fragment parameters whose values are credentials (`?token=…`, `#access_token=…`,
 * `X-Amz-Signature=…`). A name counts when it ends with a credential word in any style
 * (`authToken`, `csrftoken`, `X-Auth`, `api_key`, `userSid`). That also masks names like
 * `monkey` or `barcode`; for untrusted apps that is the safe side.
 */
const SECRET_PARAM =
  /(?:token|key|secret|session|session[_-]?id|sid|signature|sig|password|passwd|pwd|auth|authorization|code|credentials?|jwt|otp)$/i;

/**
 * URLs inside free text: absolute ones, and paths that carry a query or a fragment. Console text
 * comes from the app under review with no length limit, so a match may only start where no
 * earlier failed attempt has already scanned: a scheme at the start of its run of scheme
 * characters, a path at the start of the text or after whitespace or a quote. That keeps the
 * scan linear; the cost is that a path glued to other text (`url=/a?token=…`) is not found.
 */
const URL_IN_TEXT =
  /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+|(?<![^\s"'<>`])\/[^\s"'<>`?#]*[?#][^\s"'<>`]+/gi;

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    return name;
  }
}

function maskPairs(text: string): string {
  return text
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0) return pair;
      const name = pair.slice(0, eq);
      return name.length <= 64 && SECRET_PARAM.test(decodeName(name)) ? `${name}=[REDACTED]` : pair;
    })
    .join('&');
}

function maskFragment(fragment: string): string {
  // Hash routers (`#/login?token=…`, `#!/cb?code=…`) carry a query inside the fragment.
  const queryAt = fragment.indexOf('?');
  if (queryAt < 0 || !(fragment.startsWith('/') || fragment.startsWith('!')))
    return maskPairs(fragment);
  return `${fragment.slice(0, queryAt)}?${maskPairs(fragment.slice(queryAt + 1))}`;
}

/** Masks the values of credential-shaped parameters in a URL's query and fragment. */
function maskSecretParams(url: string): string {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? undefined : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt < 0 ? undefined : beforeHash.slice(queryAt + 1);
  return `${path}${query === undefined ? '' : `?${maskPairs(query)}`}${fragment === undefined ? '' : `#${maskFragment(fragment)}`}`;
}

/** Environment variable names that hold credentials. */
export const SECRET_ENV_NAME =
  /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|PRIVATE|API_?KEY|ACCESS_?KEY|AUTH|SESSION|COOKIE|WEBHOOK|DSN|SIGNING|_PAT$|^PAT_)/i;

export function mask(value: string, keepPrefix = 0): string {
  const visible =
    keepPrefix > 0 ? value.slice(0, Math.min(keepPrefix, Math.floor(value.length / 3))) : '';
  return `${visible}[REDACTED]`;
}

export interface RedactorOptions {
  env?: NodeJS.ProcessEnv;
  /** Additional literal values to mask (e.g. tokens passed via flags). */
  literals?: readonly string[];
}

export class Redactor {
  private readonly literals: string[];

  constructor(options: RedactorOptions = {}) {
    const values = new Set<string>();
    for (const [name, value] of Object.entries(options.env ?? {})) {
      if (value && isSecretEnv(name, value)) values.add(value);
    }
    for (const literal of options.literals ?? [])
      if (literal && literal.length >= 6) values.add(literal);
    // Longest first so overlapping secrets are fully masked.
    this.literals = [...values].sort((a, b) => b.length - a.length);
  }

  /** Redactor for the current process environment. */
  static fromProcess(literals: readonly string[] = []): Redactor {
    return new Redactor({ env: process.env, literals });
  }

  redact(text: string): string {
    if (!text) return text;
    let out = text;
    for (const literal of this.literals) {
      if (out.includes(literal)) out = out.split(literal).join('[REDACTED]');
    }
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      out = out.replace(pattern.regex, (match, ...groups) => {
        if (pattern.group) {
          const prefix = groups[pattern.group - 2] ?? '';
          return `${prefix}[REDACTED]`;
        }
        return mask(match, pattern.keepPrefix);
      });
    }
    out = out.replace(
      ASSIGNMENT_PATTERN,
      (_m, pre: string, _v: string, post: string) => `${pre}[REDACTED]${post}`,
    );
    out = out.replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}[REDACTED]@`);
    return out;
  }

  /** A URL with credential-shaped query and fragment parameters masked, then redacted as text. */
  redactUrl(url: string): string {
    return this.redact(maskSecretParams(url));
  }

  /** Text with every URL in it masked like `redactUrl` (console messages, error text). */
  redactUrls(text: string): string {
    if (!text) return text;
    return this.redact(text.replace(URL_IN_TEXT, (url) => maskSecretParams(url)));
  }

  /** Deeply redacts strings inside JSON-like values. */
  redactDeep<T>(value: T): T {
    if (typeof value === 'string') return this.redact(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.redactDeep(v)) as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.redactDeep(v);
      return out as T;
    }
    return value;
  }
}

export function isSecretEnv(name: string, value: string): boolean {
  if (!SECRET_ENV_NAME.test(name)) return false;
  if (value.length < 6) return false;
  if (/^(true|false|yes|no|on|off|null|undefined|\d+)$/i.test(value)) return false;
  return true;
}

/** Finds secrets in a single line of text; used by review rules on added lines. */
export function findSecrets(
  line: string,
): Array<{ pattern: SecretPattern; match: string; index: number }> {
  const found: Array<{ pattern: SecretPattern; match: string; index: number }> = [];
  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    for (const m of line.matchAll(regex)) {
      const value = pattern.group ? (m[pattern.group] ?? m[0]) : m[0];
      if (isPlaceholder(value)) continue;
      found.push({ pattern, match: value, index: m.index ?? 0 });
    }
  }
  return found;
}

function isPlaceholder(value: string): boolean {
  return /(x{6,}|0{8,}|example|placeholder|your[_-]?|redacted|dummy|<[^>]+>)/i.test(value);
}
