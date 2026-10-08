import type { ChangeSignals } from '@covi/core';

/** Reads what became of the changes Covi commented on, from one platform and repository. */
export interface OutcomeCollector {
  readonly platform: 'github' | 'gitlab';
  readonly repository: string;
  /**
   * One change. `commentId` names Covi's comment when a local run recorded it; it is preferred
   * only among the comments Covi's own identity wrote.
   */
  collect(number: number, hint?: { commentId?: string }): Promise<ChangeSignals>;
  /** The most recently closed (merged or not) changes, newest first. */
  recent(count: number): Promise<number[]>;
}
