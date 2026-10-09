/**
 * Fixture documents for the review pipeline. They are generated rather than stored, so the
 * repository stays small, and every character follows from a document's position, so every run
 * builds the same documents.
 */

const SENTENCES = [
  'Retries back off exponentially and stop after the fifth attempt.',
  'Every change to this policy needs a second reviewer.',
  'Sessions expire after thirty minutes without activity.',
  'Rate limits apply per account, not per address.',
  'Audit entries are kept for a year and then archived.',
  'Search indexes rebuild overnight from the primary store.',
  'Digest emails go out at nine in the morning, local time.',
  'Owners confirm the summary before a document is published.',
  'Defaults are documented next to the field they apply to.',
  'A record that fails validation comes back with its errors.',
  'Workers take queued jobs in the order they arrived.',
  'Budgets are reviewed at the end of every quarter.',
];

const TITLES = [
  'Payment retries',
  'Session cookies',
  'Rate limits',
  'Audit log retention',
  'Search index rebuilds',
  'Email digests',
];

/** About how long each document's body is, in bytes. */
const SIZES = [13800, 9200, 11400, 7600, 11900, 5400];

/** Numbered sections of policy text, `bytes` long or a little more. */
function prose(seed, bytes) {
  const sections = [];
  let size = 0;
  for (let n = 1; size < bytes; n++) {
    const text = `${n}. ${SENTENCES[(seed + n * 5) % SENTENCES.length]} ${SENTENCES[(seed + n * 7 + 3) % SENTENCES.length]}`;
    sections.push(text);
    size += text.length + 1;
  }
  return sections.join('\n');
}

/** The documents a review covers. */
export function fixtureDocuments() {
  return TITLES.map((title, i) => ({
    id: `doc-${String(i + 1).padStart(3, '0')}`,
    title,
    body: prose(i * 3, SIZES[i]),
  }));
}

/** What the reader is asked to check: the guide every review request carries. */
export function reviewGuide() {
  return prose(11, 9300);
}
