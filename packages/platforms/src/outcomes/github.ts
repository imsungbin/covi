import { anchorKeyOf, type ChangeSignals, COMMENT_MARKER, parseLedger } from '@covi/core';
import { type Author, authoredBy, type Identity } from '../github.ts';
import { ApiClient, PlatformHttpError, type RequestBudget } from '../http.ts';
import type { FetchLike } from '../types.ts';
import { findRevert, quotesComment } from './signals.ts';
import type { OutcomeCollector } from './types.ts';

interface Reactions {
  '+1'?: number;
  '-1'?: number;
}
interface IssueComment {
  id: number;
  body?: string | null;
  html_url?: string;
  created_at: string;
  user?: Author;
  reactions?: Reactions;
}
interface ReviewComment extends IssueComment {
  in_reply_to_id?: number | null;
}
interface Reaction {
  content?: string;
  user?: Author;
}
interface Pull {
  number: number;
  state: 'open' | 'closed';
  html_url?: string;
  merged_at?: string | null;
  closed_at?: string | null;
  merge_commit_sha?: string | null;
  user?: Author;
  head?: { sha?: string };
  base?: { ref?: string };
}
interface Commit {
  sha: string;
  html_url?: string;
  commit: { message: string };
}

export interface GitHubCollectorOptions {
  token: string;
  /** `owner/name`. */
  repository: string;
  apiUrl?: string;
  fetch?: FetchLike;
  budget: RequestBudget;
  sleep?: (ms: number) => Promise<void>;
  /** The bot Covi comments as when the token has no user (`publish.botLogin`). */
  botLogin?: string;
}

const REPOSITORY = /^(?!\.\.?\/)[\w.-]+\/(?!\.\.?$)[\w.-]+$/;
/** Commits since the merge are read for a revert up to this many pages (Decision 2). */
const COMMIT_PAGES = 3;
const REACTION_PAGES = 3;
/** Comment listings stop here (Decision 9). */
const LIST_PAGES = 10;

const isBot = (c: { user?: Author }) => c.user?.type === 'Bot';
const tally = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0);

/**
 * What became of a pull request Covi commented on, from GitHub's REST API (read-only). Covi's
 * comment and anchors are read only when Covi's own identity wrote them: anyone can paste the
 * marker, and what is collected here feeds the whole repository's calibration.
 */
export class GitHubCollector implements OutcomeCollector {
  readonly platform = 'github' as const;
  readonly repository: string;
  private readonly api: ApiClient;
  private readonly botLogin?: string;
  private me?: Identity;

  constructor(options: GitHubCollectorOptions) {
    if (!REPOSITORY.test(options.repository))
      throw new Error(`Not a GitHub repository (owner/name): ${options.repository.slice(0, 200)}`);
    this.repository = options.repository;
    this.botLogin = options.botLogin;
    this.api = new ApiClient({
      platform: 'GitHub',
      base: options.apiUrl ?? 'https://api.github.com',
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'covi',
      },
      fetch: options.fetch,
      budget: options.budget,
      sleep: options.sleep,
    });
  }

  async recent(count: number): Promise<number[]> {
    if (!Number.isInteger(count) || count < 1) return [];
    const pulls = await this.api.getAll<{ number?: unknown }>(
      `/repos/${this.repository}/pulls?state=closed&sort=updated&direction=desc&per_page=${Math.min(count, 100)}`,
      Math.ceil(count / 100),
    );
    return pulls
      .map((p) => p.number)
      .filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
      .slice(0, count);
  }

  async collect(number: number, hint: { commentId?: string } = {}): Promise<ChangeSignals> {
    if (!Number.isInteger(number) || number < 1)
      throw new Error(`Not a pull request number: ${number}`);
    const repo = this.repository;
    const { data: pull } = await this.api.get<Pull>(`/repos/${repo}/pulls/${number}`);
    const state = pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : 'open';
    const signals: ChangeSignals = {
      platform: 'github',
      repository: repo,
      number,
      url: pull.html_url,
      state,
      ...(typeof pull.head?.sha === 'string' ? { head: pull.head.sha } : {}),
      ...(pull.closed_at ? { closedAt: pull.closed_at } : {}),
      // Unknown when GitHub leaves it out: then no one's votes are excluded.
      author: typeof pull.user?.id === 'number' ? String(pull.user.id) : '',
      anchors: [],
    };
    const note = (text: string) => {
      signals.notes = [...(signals.notes ?? []), text];
    };
    const comments = await this.list<IssueComment>(
      'issue comments',
      `/repos/${repo}/issues/${number}/comments?per_page=100`,
      note,
    );
    const marked = comments.filter(
      (c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER),
    );
    const own = marked.length ? await this.own(marked) : [];
    // The comment a run recorded, if Covi wrote it, else Covi's first. None: nothing to collect.
    const sticky = own.find((c) => String(c.id) === hint.commentId) ?? own[0];
    if (!sticky) return signals;
    const body = sticky.body ?? '';
    const me = await this.identity();
    const person = (c: { user?: Author }) => !isBot(c) && !this.covi(c.user, me);
    signals.comment = {
      id: String(sticky.id),
      url: sticky.html_url,
      body,
      up: tally(sticky.reactions?.['+1']),
      down: tally(sticky.reactions?.['-1']),
      replies: comments.filter(
        (c) =>
          c.id !== sticky.id &&
          person(c) &&
          c.created_at >= sticky.created_at &&
          quotesComment(c.body ?? '', body),
      ).length,
    };
    // Anchors exist only for confirmed and likely findings, and only the ledger's keys count.
    const keys = new Set(
      parseLedger(body)
        ?.findings.filter((e) => e.c === 'confirmed' || e.c === 'likely')
        .map((e) => e.k),
    );
    if (keys.size) {
      const review = await this.list<ReviewComment>(
        'review comments',
        `/repos/${repo}/pulls/${number}/comments?per_page=100`,
        note,
      );
      for (const anchor of this.anchorsOf(review, keys, me))
        signals.anchors.push({
          key: anchor.key,
          id: String(anchor.comment.id),
          reactions: await this.votes(anchor.comment, note),
          replies: review.filter((r) => r.in_reply_to_id === anchor.comment.id && person(r)).length,
        });
    }
    if (state === 'merged' && pull.merge_commit_sha && pull.merged_at && pull.base?.ref) {
      // From the merge forward: a revert usually follows soon, and a later collect must still
      // see that stretch however many commits land after it.
      const { items: commits, truncated } = await this.api.getOldestFirst<Commit>(
        `/repos/${repo}/commits?sha=${encodeURIComponent(pull.base.ref)}&since=${encodeURIComponent(pull.merged_at)}&per_page=100`,
        COMMIT_PAGES,
      );
      if (truncated)
        note(
          `commits since the merge: more than ${COMMIT_PAGES} pages; read the ${COMMIT_PAGES - 1} nearest the merge and the newest, so a revert in between is missed`,
        );
      const revert = findRevert(
        commits
          .filter((c) => typeof c.sha === 'string' && typeof c.commit?.message === 'string')
          .map((c) => ({ sha: c.sha, message: c.commit.message, url: c.html_url })),
        { shas: [pull.merge_commit_sha], mentions: [`Reverts ${repo}#${number}`] },
      );
      if (revert) signals.revertedBy = revert;
    }
    return signals;
  }

  /**
   * Who the token is, asked once. A workflow or app token cannot read `/user` (401/403): then
   * Covi is its bot. Anything else (a rate limit, an outage) throws rather than guess.
   */
  private async identity(): Promise<Identity> {
    if (this.me) return this.me;
    try {
      const { data } = await this.api.get<{ id?: unknown }>('/user');
      if (typeof data?.id !== 'number') throw new Error('GitHub sent no user id for /user');
      this.me = { user: data.id };
    } catch (error) {
      if (!(error instanceof PlatformHttpError && (error.status === 401 || error.status === 403)))
        throw error;
      this.me = { user: null };
    }
    return this.me;
  }

  /**
   * Whether Covi wrote a comment: the token's own user, or Covi's bot (exact login, type Bot)
   * even when the token is a person's, because a maintainer collecting with their own token must
   * still read what CI posted. The publisher is stricter: it edits the comment it finds.
   */
  private covi(user: Author, me: Identity): boolean {
    return authoredBy(user, me, this.botLogin) || authoredBy(user, { user: null }, this.botLogin);
  }

  private async own<T extends { user?: Author }>(comments: readonly T[]): Promise<T[]> {
    const me = await this.identity();
    return comments.filter((c) => this.covi(c.user, me));
  }

  /** Every page of a list up to the limit, with a note when the limit left pages unread. */
  private async list<T>(
    what: string,
    path: string,
    note: (text: string) => void,
    maxPages = LIST_PAGES,
  ): Promise<T[]> {
    const { items, truncated } = await this.api.getPages<T>(path, maxPages);
    if (truncated) note(`${what}: only the first ${maxPages} pages were read`);
    return items;
  }

  /** Covi's first anchor for each of the ledger's keys; a pasted or echoed one never counts. */
  private anchorsOf(comments: readonly ReviewComment[], keys: ReadonlySet<string>, me: Identity) {
    const byKey = new Map<string, ReviewComment>();
    for (const c of comments) {
      const key = c.in_reply_to_id ? undefined : anchorKeyOf(c.body ?? '');
      if (
        key &&
        keys.has(key) &&
        !byKey.has(key) &&
        Number.isInteger(c.id) &&
        this.covi(c.user, me)
      )
        byKey.set(key, c);
    }
    return [...byKey].map(([key, comment]) => ({ key, comment }));
  }

  /**
   * Each 👍 and 👎 on an anchor with who gave it, so the author's own votes can be left out. Most
   * anchors get none, so one whose summary shows none costs no request.
   */
  private async votes(
    anchor: ReviewComment,
    note: (text: string) => void,
  ): Promise<ChangeSignals['anchors'][number]['reactions']> {
    const summary = anchor.reactions;
    if (summary && tally(summary['+1']) + tally(summary['-1']) === 0) return [];
    const reactions = await this.list<Reaction>(
      `reactions on anchor ${anchor.id}`,
      `/repos/${this.repository}/pulls/comments/${anchor.id}/reactions?per_page=100`,
      note,
      REACTION_PAGES,
    );
    return reactions.flatMap((r) =>
      typeof r.user?.id === 'number' && (r.content === '+1' || r.content === '-1')
        ? [
            {
              user: String(r.user.id),
              vote: r.content === '+1' ? ('up' as const) : ('down' as const),
            },
          ]
        : [],
    );
  }
}
