import type { ChangedFile, CodeChange, Surface } from './change.ts';

/**
 * ReviewContext is the output of the Understand phase: a structured, reusable description of a
 * change that every later stage (explain, review, demonstrate, video) and every agent reads.
 */

export type IntentKind =
  | 'feature'
  | 'bug-fix'
  | 'refactor'
  | 'performance'
  | 'visual'
  | 'docs'
  | 'test'
  | 'dependency'
  | 'config'
  | 'build'
  | 'ci'
  | 'chore'
  | 'security'
  | 'revert'
  | 'mixed'
  | 'unknown';

export type Confidence = 'high' | 'medium' | 'low';

export interface Intent {
  kind: IntentKind;
  /** One-line statement of what the change appears to do, hedged when confidence is low. */
  summary: string;
  confidence: Confidence;
  evidence: string[];
  /** Present when signals conflict or are missing; Covi states ambiguity instead of inventing intent. */
  ambiguity?: string;
  secondary: IntentKind[];
  /** Conventional-commit scope (e.g. `cart` in `fix(cart): ...`), when one names the area. */
  scope?: string;
  /** Where the summary came from: the PR/MR title, a commit subject, or the files. */
  basis: 'title' | 'commit' | 'files';
}

export type SizeClass = 'trivial' | 'small' | 'medium' | 'large' | 'huge';

export interface ChangeSize {
  class: SizeClass;
  changedLines: number;
  files: number;
  areas: number;
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'component'
  | 'hook'
  | 'type'
  | 'interface'
  | 'enum'
  | 'constant'
  | 'variable'
  | 'route'
  | 'selector'
  | 'test';

export interface SymbolChange {
  name: string;
  kind: SymbolKind;
  change: 'added' | 'removed' | 'modified';
  path: string;
  line?: number;
  exported: boolean;
}

export interface DependencyChange {
  name: string;
  manifest: string;
  ecosystem: 'npm' | 'pypi' | 'go' | 'cargo' | 'rubygems';
  change: 'added' | 'removed' | 'upgraded' | 'downgraded' | 'changed';
  from?: string;
  to?: string;
  /** Major version changed (semver), which often means breaking changes. */
  major: boolean;
  dev: boolean;
}

export interface EnvVarChange {
  name: string;
  change: 'added' | 'removed';
  path: string;
  line?: number;
  /** Mentioned in an env example file, docs, or deployment config in the head revision. */
  documented: boolean;
}

export interface RouteChange {
  method?: string;
  path: string;
  change: 'added' | 'removed' | 'modified';
  file: string;
  line?: number;
}

export type DataOperation =
  | 'create-table'
  | 'drop-table'
  | 'rename-table'
  | 'add-column'
  | 'drop-column'
  | 'rename-column'
  | 'alter-column'
  | 'add-index'
  | 'drop-index'
  | 'data'
  | 'other';

export interface DataChange {
  operation: DataOperation;
  table?: string;
  column?: string;
  file: string;
  line?: number;
  destructive: boolean;
  statement: string;
}

export interface Area {
  id: string;
  /** Display name, e.g. "comments UI" or "api/users". */
  name: string;
  path: string;
  surfaces: Surface[];
  files: string[];
  additions: number;
  deletions: number;
}

export interface TestSummary {
  changedTestFiles: string[];
  addedTestCases: number;
  removedTestCases: number;
  /** Source files that changed behavior without any accompanying test change. */
  untestedSourceFiles: string[];
  repoHasTests: boolean;
  frameworks: string[];
}

export type DemoKind = 'ui' | 'visual' | 'interaction' | 'cli' | 'api' | 'architecture';

export interface DemoCandidate {
  kind: DemoKind;
  /** URL path, command, or request that would show the change. */
  target: string;
  reason: string;
}

export interface DemonstrationAssessment {
  value: 'high' | 'medium' | 'low' | 'none';
  kinds: DemoKind[];
  recommendation: 'video' | 'screenshots' | 'text-only';
  reasons: string[];
  runnable: {
    /** Covi knows how to run the software (configuration or a safe static site). */
    available: boolean;
    mode?: 'static' | 'command';
    staticRoot?: string;
    /** Commands Covi detected but will not run until they are configured. */
    suggestions: string[];
    flows: number;
    commands: number;
    requests: number;
  };
  candidates: DemoCandidate[];
}

export interface Signal {
  id: string;
  message: string;
  path?: string;
  line?: number;
}

export interface ReadingStep {
  path: string;
  reason: string;
}

export type FileDigest = Omit<ChangedFile, 'hunks'> & { hunkCount: number };

export type ChangeDigest = Omit<CodeChange, 'files'> & { files: FileDigest[] };

export interface ReviewContext {
  schemaVersion: 1;
  generatedAt: string;
  change: ChangeDigest;
  size: ChangeSize;
  intent: Intent;
  areas: Area[];
  surfaces: Partial<Record<Surface, string[]>>;
  symbols: SymbolChange[];
  dependencies: DependencyChange[];
  envVars: EnvVarChange[];
  routes: RouteChange[];
  data: DataChange[];
  tests: TestSummary;
  demonstration: DemonstrationAssessment;
  readingOrder: ReadingStep[];
  signals: Signal[];
  notes: string[];
  ambiguities: string[];
}

export function digestChange(change: CodeChange): ChangeDigest {
  return {
    ...change,
    files: change.files.map(({ hunks, ...rest }) => ({ ...rest, hunkCount: hunks.length })),
  };
}
