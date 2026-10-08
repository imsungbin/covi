// Public API of @covi/core. Exports are kept sorted by module path (the formatter enforces it).
export {
  CONFIG_FILES,
  type ConfigOrigin,
  loadRepositoryConfig,
  parseYamlConfig,
} from './config/load.ts';
export {
  type ConfigLayer,
  type ConfigLayerName,
  configFromEnv,
  LAYER_ORDER,
  parseConfigInput,
  type ResolvedConfig,
  resolveConfig,
} from './config/resolve.ts';
export * from './config/schema.ts';
export {
  buildEvidence,
  diffHunkEvidence,
  type EvidenceSources,
  evidenceFiles,
} from './evidence/build.ts';
export {
  citationProblems,
  citeChanges,
  type EvidenceIndex,
  type GroundableFinding,
  type Grounded,
  groundFinding,
  hunksAt,
  hunksOf,
  indexEvidence,
  ungroundedStatements,
  unknownCitations,
} from './evidence/cite.ts';
export { evidenceId, evidencePart } from './evidence/ids.ts';
export {
  type ExecResult,
  exec,
  execShell,
  type ServiceHandle,
  startService,
  which,
} from './exec/exec.ts';
export {
  dataPhrase,
  depthFor,
  explainHeuristically,
  intentSentence,
  intentStatement,
} from './explain/heuristic.ts';
export { type ParsedFile, parseDiff, unquote } from './git/diff-parser.ts';
export {
  EMPTY_TREE,
  Git,
  GitError,
  gitEnv,
  repoNameFromRemote,
  sanitizeRemote,
} from './git/git.ts';
export { type GrepHit, RevisionReader } from './git/reader.ts';
export {
  type ChangeScope,
  detectBaseBranch,
  NoChangesError,
  type ResolveOptions,
  resolveChange,
} from './git/resolve.ts';
export * from './i18n/catalog.ts';
export * from './i18n/korean.ts';
export * from './i18n/language.ts';
export * from './i18n/schema.ts';
export {
  analyzeWithModel,
  buildAnalysisSystemPrompt,
  createProvider,
  type ModelAnalysis,
  ModelAnalysisSchema,
  PIPELINE_PREAMBLE,
} from './intelligence/analyze.ts';
export { AnthropicProvider, FALLBACK_BETA } from './intelligence/anthropic.ts';
export { CommandProvider } from './intelligence/command.ts';
export { extractJson, structuredSchema, validateWith } from './intelligence/json.ts';
export {
  chooseProvider,
  DEFAULT_MODEL,
  type GenerateRequest,
  type ModelProvider,
  type ProviderChoice,
  ProviderError,
} from './intelligence/provider.ts';
export * from './model/behavior.ts';
export * from './model/change.ts';
export * from './model/context.ts';
export * from './model/demo.ts';
export * from './model/evidence.ts';
export * from './model/explanation.ts';
export * from './model/finding.ts';
export { renderBrief } from './report/brief.ts';
export { COMMENT_MARKER, type CommentLinks, renderComment, safeUrl } from './report/comment.ts';
export { renderDiffDigest, renderFileDiff, renderHunk } from './report/digest.ts';
export {
  locationText,
  renderExplanation,
  renderReview,
  renderSummary,
  reportLanguage,
  type SummaryFormat,
} from './report/markdown.ts';
export {
  coviHome,
  listSkills,
  loadSkill,
  methodologyOf,
  resourcePath,
  type SkillDocument,
} from './resources.ts';
export { type BuiltReview, buildReview, runRules, summarizeFindings } from './review/engine.ts';
export { RULES, type Rule, type RuleContext } from './review/rules/index.ts';
export * from './run/paths.ts';
export * from './run/run.ts';
export { childEnv } from './security/env.ts';
export { findSecrets, isSecretEnv, mask, Redactor, SECRET_PATTERNS } from './security/redact.ts';
export {
  describeCommands,
  type ExecutionPolicy,
  type RepositoryCommand,
  repositoryCommands,
  TRUST_HINT,
  TrustStore,
  trustFile,
  withoutRepositoryCommands,
} from './security/trust.ts';
export { type StaticServer, serveStatic } from './serve/static-server.ts';
export { areaKey, groupAreas } from './understand/areas.ts';
export { type Classification, classifyFile, ignoreReason } from './understand/classify.ts';
export { assessDemonstration, pagePathFor, type RepoShape } from './understand/demonstration.ts';
export { diffManifest } from './understand/dependencies.ts';
export { extractEnvVars } from './understand/env-vars.ts';
export { cleanSubject, inferIntent } from './understand/intent.ts';
export { extractDataChanges } from './understand/migrations.ts';
export {
  countTestCases,
  diffSymbols,
  type ExtractedSymbol,
  extractRoutes,
  extractSymbols,
} from './understand/symbols.ts';
export { understandChange } from './understand/understand.ts';
export { formatDuration, formatTimestamp, parseDuration } from './util/duration.ts';
export {
  CoviError,
  EnvironmentError,
  ExitCode,
  type ExitCodeValue,
  errorMessage,
  UsageError,
} from './util/errors.ts';
export {
  ensureDir,
  exists,
  readJson,
  readTextIfExists,
  writeFileAtomic,
  writeJson,
} from './util/fs.ts';
export { matchesAny, matchesGlob } from './util/glob.ts';
export { seededRandom, seedFrom, sha256, sha256File, shortHash } from './util/hash.ts';
export { type Logger, type LogRecord, MemoryLogger, silentLogger, TeeLogger } from './util/log.ts';
export * from './util/text.ts';
export { formatIssues, parseOrThrow } from './util/zod.ts';
