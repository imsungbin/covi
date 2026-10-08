/** Markdown emphasis that a rendered quote loses, so quotes are compared without it. */
const plain = (text: string) => text.replace(/[\\*_`]/g, '');

/**
 * Whether a comment quotes Covi's comment. GitHub issue comments have no threads, so quoting is
 * how people answer one. A quote must be long enough to mean something.
 */
export function quotesComment(reply: string, comment: string): boolean {
  const target = plain(comment);
  return reply.split('\n').some((line) => {
    const quoted = /^\s*>\s?(.*)$/.exec(line)?.[1];
    const text = quoted === undefined ? '' : plain(quoted).trim();
    return text.length >= 12 && target.includes(text);
  });
}

/**
 * The first commit that reverts a merged change: git's "This reverts commit <sha>" naming one of
 * its commits, or the platform's own revert mention. A mention must not run on into more digits,
 * so #70 is not #7.
 */
export function findRevert(
  commits: ReadonlyArray<{ sha: string; message: string; url?: string }>,
  target: { shas: readonly string[]; mentions: readonly string[] },
): { sha: string; url?: string } | undefined {
  const shas = target.shas.filter((s) => /^[0-9a-f]{7,64}$/i.test(s)).map((s) => s.toLowerCase());
  const mentions = target.mentions.map(
    (m) => new RegExp(`${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`, 'i'),
  );
  for (const commit of commits) {
    const message = commit.message.toLowerCase();
    const reverted = [...message.matchAll(/this reverts commit ([0-9a-f]{7,64})/g)].some((m) =>
      shas.some((sha) => sha.startsWith(m[1]!) || m[1]!.startsWith(sha)),
    );
    const mentioned = mentions.some((mention) => mention.test(commit.message));
    if (reverted || mentioned)
      return commit.url ? { sha: commit.sha, url: commit.url } : { sha: commit.sha };
  }
  return undefined;
}
