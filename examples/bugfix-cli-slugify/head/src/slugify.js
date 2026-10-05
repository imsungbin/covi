/**
 * Turns a title into a URL-friendly slug.
 * Accented letters keep their base letter ("é" → "e"); runs of separators collapse into one dash.
 */
export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
