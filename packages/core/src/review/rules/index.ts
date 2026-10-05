import { clickOnStaticElement, focusOutlineRemoved, imgMissingAlt } from './accessibility.ts';
import {
  asyncForEach,
  destructiveMigration,
  emptyCatch,
  errorHandlingRemoved,
  removedExportStillReferenced,
  routeRemoved,
  schemaWithoutMigration,
} from './correctness.ts';
import {
  debugLeftover,
  focusedTest,
  mergeConflictMarkers,
  secretInDiff,
  skippedTest,
} from './hygiene.ts';
import {
  envVarUndocumented,
  intentMismatch,
  lockfileOutOfSync,
  majorDependencyUpgrade,
  missingTests,
} from './project.ts';
import {
  dangerousHtml,
  dynamicCodeExecution,
  sqlStringBuilding,
  workflowBroadPermissions,
  workflowPullRequestTarget,
  workflowScriptInjection,
} from './security.ts';
import type { Rule } from './types.ts';

/** Built-in rules, in the order their findings are most useful to read. */
export const RULES: readonly Rule[] = [
  secretInDiff,
  mergeConflictMarkers,
  workflowPullRequestTarget,
  workflowScriptInjection,
  sqlStringBuilding,
  removedExportStillReferenced,
  routeRemoved,
  destructiveMigration,
  schemaWithoutMigration,
  lockfileOutOfSync,
  focusedTest,
  asyncForEach,
  dynamicCodeExecution,
  dangerousHtml,
  emptyCatch,
  errorHandlingRemoved,
  imgMissingAlt,
  focusOutlineRemoved,
  clickOnStaticElement,
  workflowBroadPermissions,
  missingTests,
  majorDependencyUpgrade,
  envVarUndocumented,
  skippedTest,
  debugLeftover,
  intentMismatch,
];

export type { Rule, RuleContext } from './types.ts';
