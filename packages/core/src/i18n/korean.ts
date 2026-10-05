/**
 * Korean particles agree with the last sound of the word they follow: 을 after a final consonant
 * (받침), 를 after a vowel. Code changes are full of Latin names and numbers, so the last sound
 * comes from how they are read aloud: `URL` ends in 엘 (ㄹ), `API` in 아이 (a vowel).
 */

/** The last sound of a word: no final consonant, final ㄹ (special for 로), or another one. */
export type FinalSound = 'vowel' | 'rieul' | 'consonant';

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const RIEUL = 8;

/** How each Latin letter ends when read aloud in Korean (에이, 비, … 엘, 엠, 엔, … 알, …). */
const LETTER_FINAL: Record<string, FinalSound> = {
  L: 'rieul',
  M: 'consonant',
  N: 'consonant',
  R: 'rieul',
};

/** Sino-Korean digits: 영 일 이 삼 사 오 육 칠 팔 구. */
const DIGIT_FINAL: FinalSound[] = [
  'consonant',
  'rieul',
  'vowel',
  'consonant',
  'vowel',
  'vowel',
  'consonant',
  'rieul',
  'rieul',
  'vowel',
];

/** Characters that do not change how a word ends: quotes, closing brackets, Markdown marks. */
const TRAILING = /[\s'"`’”」』)\]}）】〉》*_~]+$/u;

/**
 * Words whose Korean reading ends differently from what their spelling suggests. Keys are
 * matched case-insensitively against the last Latin word.
 */
const WORD_FINALS: Record<string, FinalSound> = {
  json: 'consonant',
  yaml: 'rieul',
  nasa: 'vowel',
  gif: 'vowel',
  jpeg: 'consonant',
  rest: 'vowel',
  crud: 'vowel',
  cors: 'vowel',
  dom: 'consonant',
  ram: 'consonant',
  ascii: 'vowel',
  sql: 'rieul',
  url: 'rieul',
  html: 'rieul',
  xml: 'rieul',
  type: 'consonant',
  map: 'consonant',
  tab: 'consonant',
  web: 'consonant',
  app: 'consonant',
  chat: 'consonant',
  set: 'consonant',
  get: 'consonant',
  hook: 'consonant',
  book: 'consonant',
  lock: 'consonant',
  cookie: 'vowel',
};

/** How `text` ends when read aloud, or undefined when it ends in something unpronounceable. */
export function finalSound(text: string): FinalSound | undefined {
  const t = text.replace(TRAILING, '');
  const last = t.at(-1);
  if (!last) return undefined;
  const code = last.codePointAt(0)!;
  if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
    const jong = (code - HANGUL_BASE) % 28;
    return jong === 0 ? 'vowel' : jong === RIEUL ? 'rieul' : 'consonant';
  }
  if (/\d/.test(last)) return numberFinal(t);
  if (/[A-Za-z]/.test(last)) {
    const word = /[A-Za-z]+$/.exec(t)![0];
    const known = WORD_FINALS[word.toLowerCase()];
    if (known) return known;
    // Acronyms are read letter by letter; words by their English sound.
    if (/^[A-Z]+s?$/.test(word) && word.length <= 6)
      return LETTER_FINAL[word.replace(/s$/, '').at(-1)!] ?? 'vowel';
    const w = word.toLowerCase();
    if (/(l|le)$/.test(w)) return 'rieul';
    if (/(m|n|ng)$/.test(w)) return 'consonant';
    return 'vowel';
  }
  return undefined;
}

function numberFinal(text: string): FinalSound {
  const number = /(\d+)$/.exec(text)![1]!;
  const zeros = /0*$/.exec(number)![0].length;
  if (zeros > 0 && zeros < number.length) {
    // 십, 백, 천, 만, 억 all end in a consonant.
    return 'consonant';
  }
  return DIGIT_FINAL[Number(number.at(-1))]!;
}

/** Particle pairs: [after a final consonant, after a vowel]. 으로/로 also takes 로 after ㄹ. */
export const PARTICLES: ReadonlyArray<readonly [string, string]> = [
  ['을', '를'],
  ['이', '가'],
  ['은', '는'],
  ['과', '와'],
  ['으로', '로'],
  ['이나', '나'],
  ['이라', '라'],
  ['이랑', '랑'],
  ['이며', '며'],
  ['이에요', '예요'],
  ['이야', '야'],
];

const BY_FORM = new Map<string, readonly [string, string]>();
for (const pair of PARTICLES) for (const form of pair) BY_FORM.set(form, pair);

/** The particle (from either form of a pair, e.g. `을` or `를`) that agrees with `word`. */
export function particle(word: string, form: string): string {
  const pair = BY_FORM.get(form);
  if (!pair) return form;
  const final = finalSound(word);
  if (final === undefined) return pair[1] === '로' ? '(으)로' : `${pair[0]}(${pair[1]})`;
  if (pair[1] === '로') return final === 'consonant' ? pair[0] : pair[1];
  return final === 'vowel' ? pair[1] : pair[0];
}

/**
 * Resolves particle markers in a message: `{을/를}` (or any listed pair) becomes the form that
 * agrees with the text right before it. `{name}{을/를} 추가합니다` → `JSON을 추가합니다`.
 */
export function applyParticles(text: string): string {
  return text.replace(
    /\{([가-힣]+)\/([가-힣]+)\}/g,
    (match, a: string, _b: string, offset: number) =>
      BY_FORM.has(a) ? particle(text.slice(0, offset), a) : match,
  );
}

const PARTICLE_AFTER = new RegExp(
  `^(${[...BY_FORM.keys()].sort((a, b) => b.length - a.length).join('|')})(?![가-힣])`,
);

/**
 * After a word was replaced by its spoken form (`CLI` → `씨엘아이`), the particle the author
 * attached may no longer agree. Returns the corrected particle at the start of `rest`, or
 * undefined when `rest` does not start with a standalone particle.
 */
export function agreeingParticle(
  spoken: string,
  rest: string,
): { from: string; to: string } | undefined {
  const m = PARTICLE_AFTER.exec(rest);
  if (!m) return undefined;
  const from = m[1]!;
  const to = particle(spoken, from);
  if (to.includes('(')) return undefined;
  return { from, to };
}
