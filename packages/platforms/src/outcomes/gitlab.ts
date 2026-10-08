import { type ChangeSignals, COMMENT_MARKER, REPOSITORY_PATTERN } from '@covi/core';
import {
  ApiClient,
  BudgetExhaustedError,
  PlatformHttpError,
  RateLimitedError,
  type RequestBudget,
} from '../http.ts';
import type { FetchLike } from '../types.ts';
import { findRevert } from './signals.ts';
import type { OutcomeCollector } from './types.ts';

type User = { id?: unknown; username?: unknown } | null | undefined;
interface Note {
  id: number;
  body?: string | null;
  system?: boolean;
  author?: User;
}
interface Discussion {
  notes?: Note[] | null;
}
interface MergeRequest {
  iid?: unknown;
  state?: string;
  /** The merge request's head commit. */
  sha?: string | null;
  web_url?: string;
  merged_at?: string | null;
  closed_at?: string | null;
  merge_commit_sha?: string | null;
  squash_commit_sha?: string | null;
  target_branch?: string;
  author?: User;
}
interface Award {
  name?: string;
  user?: User;
}
interface Commit {
  id?: string;
  message?: string;
  web_url?: string;
}

export interface GitLabCollectorOptions {
  token: string;
  /** The project's path (`group/name`, subgroups included). */
  repository: string;
  apiUrl: string;
  fetch?: FetchLike;
  budget: RequestBudget;
  sleep?: (ms: number) => Promise<void>;
  /** `publish.gitlabBotUser`: the bot user CI comments as, for a collect with another token. */
  botUser?: string;
}

/** Commits since the merge are read for a revert up to this many pages (Decision 2). */
const COMMIT_PAGES = 3;
const AWARD_PAGES = 3;
/** Discussion listings stop here (Decision 9). */
const LIST_PAGES = 10;

const userId = (user: User) => (typeof user?.id === 'number' ? user.id : undefined);

/**
 * What became of a merge request Covi commented on, from GitLab's REST API (read-only). Covi's
 * note is read only when Covi wrote it (the token's own user, or the configured bot user): anyone
 * can paste the marker, and what is collected here feeds the whole repository's calibration. It
 * has no per-finding anchors: positioned diff notes are not posted by Covi yet.
 */
export class GitLabCollector implements OutcomeCollector {
  readonly platform = 'gitlab' as const;
  readonly repository: string;
  private readonly api: ApiClient;
  private readonly botUser?: string;
  private me?: { user: number | null };
  /** Whether GitLab confirmed a user id as the configured bot, asked once per id. */
  private readonly bots = new Map<number, boolean>();

  constructor(options: GitLabCollectorOptions) {
    // A path, as outcome files name the project; a numeric project id would not fit them.
    if (options.repository.length > 200 || !REPOSITORY_PATTERN.test(options.repository))
      throw new Error(
        `Not a GitLab project path (group/name): ${options.repository.slice(0, 200)}`,
      );
    this.repository = options.repository;
    this.botUser = options.botUser;
    this.api = new ApiClient({
      platform: 'GitLab',
      base: options.apiUrl,
      headers: { 'PRIVATE-TOKEN': options.token, 'user-agent': 'covi' },
      fetch: options.fetch,
      budget: options.budget,
      sleep: options.sleep,
    });
  }

  private get project(): string {
    return `/projects/${encodeURIComponent(this.repository)}`;
  }

  async recent(count: number): Promise<number[]> {
    if (!Number.isInteger(count) || count < 1) return [];
    // GitLab filters by one state at a time, so open ones are listed too and left out here.
    const requests = await this.api.getAll<MergeRequest>(
      `${this.project}/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=100`,
      Math.ceil(count / 100),
    );
    return requests
      .filter((r) => r.state === 'merged' || r.state === 'closed')
      .map((r) => r.iid)
      .filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
      .slice(0, count);
  }

  async collect(number: number, hint: { commentId?: string } = {}): Promise<ChangeSignals> {
    if (!Number.isInteger(number) || number < 1)
      throw new Error(`Not a merge request number: ${number}`);
    const path = `${this.project}/merge_requests/${number}`;
    const { data: mr } = await this.api.get<MergeRequest>(path);
    const state = mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed';
    const closedAt =
      state === 'merged' ? mr.merged_at : state === 'closed' ? mr.closed_at : undefined;
    const author = userId(mr.author);
    const signals: ChangeSignals = {
      platform: 'gitlab',
      repository: this.repository,
      number,
      url: mr.web_url,
      state,
      ...(typeof mr.sha === 'string' ? { head: mr.sha } : {}),
      ...(closedAt ? { closedAt } : {}),
      // Unknown when GitLab leaves it out: then no one's votes are excluded.
      author: author === undefined ? '' : String(author),
      anchors: [],
    };
    const note = (text: string) => {
      signals.notes = [...(signals.notes ?? []), text];
    };
    const discussions = await this.list<Discussion>(
      'discussions',
      `${path}/discussions?per_page=100`,
      note,
    );
    const marked = discussions.flatMap((discussion) =>
      (discussion.notes ?? [])
        .filter(
          (n) =>
            !n.system &&
            Number.isInteger(n.id) &&
            typeof n.body === 'string' &&
            n.body.includes(COMMENT_MARKER),
        )
        .map((n) => ({ discussion, note: n })),
    );
    const me = marked.length ? await this.whoami() : null;
    const own: typeof marked = [];
    for (const m of marked) if (await this.covi(m.note.author, me)) own.push(m);
    // The note a run recorded, if Covi wrote it, else Covi's newest, which the publisher updates
    // (discussions come oldest first). None: nothing to collect.
    const sticky = own.find((m) => String(m.note.id) === hint.commentId) ?? own.at(-1);
    if (sticky) {
      const id = sticky.note.id;
      const awards = await this.list<Award>(
        `award emoji on note ${id}`,
        `${path}/notes/${id}/award_emoji?per_page=100`,
        note,
        AWARD_PAGES,
      );
      // The author would rather their change look good, so their own emoji say little. Someone
      // who gave both 👍 and 👎 has not decided, so they count on neither side.
      const given = new Map<number, Set<string>>();
      for (const a of awards) {
        const user = userId(a.user);
        if (user !== undefined && user !== author && typeof a.name === 'string')
          given.set(user, (given.get(user) ?? new Set()).add(a.name));
      }
      const votes = (name: string) =>
        [...given.values()].filter(
          (names) => names.has(name) && !names.has(name === 'thumbsup' ? 'thumbsdown' : 'thumbsup'),
        ).length;
      signals.comment = {
        id: String(id),
        url: mr.web_url ? `${mr.web_url}#note_${id}` : undefined,
        body: sticky.note.body ?? '',
        up: votes('thumbsup'),
        down: votes('thumbsdown'),
        replies: (sticky.discussion.notes ?? []).filter(
          (n) =>
            n.id !== id &&
            !n.system &&
            userId(n.author) !== me &&
            userId(n.author) !== userId(sticky.note.author),
        ).length,
      };
    }
    if (state === 'merged' && mr.merged_at && mr.target_branch) {
      // From the merge forward, as on GitHub: a revert usually follows soon.
      const window = await this.api.getOldestFirst<Commit>(
        `${this.project}/repository/commits?ref_name=${encodeURIComponent(mr.target_branch)}&since=${encodeURIComponent(mr.merged_at)}&per_page=100`,
        COMMIT_PAGES,
      );
      if (window.newestOnly)
        note(
          'commits since the merge: GitLab linked no last page, so only the newest page was read and a revert nearer the merge is missed',
        );
      else if (window.truncated)
        note(
          `commits since the merge: more than ${COMMIT_PAGES} pages; read the ${COMMIT_PAGES - 1} nearest the merge and the newest, so a revert in between is missed`,
        );
      const revert = findRevert(
        window.items.flatMap((c) =>
          typeof c.id === 'string' && typeof c.message === 'string'
            ? [{ sha: c.id, message: c.message, url: c.web_url }]
            : [],
        ),
        {
          shas: [mr.merge_commit_sha, mr.squash_commit_sha].filter(
            (s): s is string => typeof s === 'string',
          ),
          mentions: [`This reverts merge request !${number}`],
        },
      );
      if (revert) signals.revertedBy = revert;
    }
    return signals;
  }

  /**
   * Whether Covi wrote a note: the token's own user, or the configured bot user, so a maintainer
   * collecting with their own token still reads what CI posted. A username alone is not enough:
   * GitLab must say the account is a bot.
   */
  private async covi(author: User, me: number | null): Promise<boolean> {
    const id = userId(author);
    if (id === undefined) return false;
    if (id === me) return true;
    return Boolean(this.botUser) && author?.username === this.botUser && (await this.isBot(id));
  }

  /**
   * One `GET /users/:id` per id: the same id and username, and `bot: true`. Any other answer, or a
   * refusal, is "no". A rate limit or the budget stops the collect instead, and is not remembered.
   */
  private async isBot(id: number): Promise<boolean> {
    const known = this.bots.get(id);
    if (known !== undefined) return known;
    let bot: boolean;
    try {
      const { data } = await this.api.get<{ id?: unknown; username?: unknown; bot?: unknown }>(
        `/users/${id}`,
      );
      bot = data?.id === id && data.username === this.botUser && data.bot === true;
    } catch (error) {
      if (error instanceof RateLimitedError || error instanceof BudgetExhaustedError) throw error;
      bot = false;
    }
    this.bots.set(id, bot);
    return bot;
  }

  /**
   * The token's own user id, asked once, or `null` when the token cannot say (401/403): then only
   * a confirmed bot user's note counts. Anything else (a rate limit, an outage) throws rather than
   * guess.
   */
  private async whoami(): Promise<number | null> {
    if (this.me) return this.me.user;
    try {
      const { data } = await this.api.get<{ id?: unknown }>('/user');
      if (typeof data?.id !== 'number') throw new Error('GitLab sent no user id for /user');
      this.me = { user: data.id };
    } catch (error) {
      if (!(error instanceof PlatformHttpError && (error.status === 401 || error.status === 403)))
        throw error;
      this.me = { user: null };
    }
    return this.me.user;
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
}
