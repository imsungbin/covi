import {
  type CoviConfig,
  DemoCommandSchema,
  DemoRequestSchema,
  type Flow,
  FlowSchema,
  parseOrThrow,
  type ReviewContext,
  type Subject,
  screenPath,
  VIEWPORTS,
} from '@covi/core';
import { z } from 'zod';

/** What to demonstrate. Agents may author `demo/plan.json`; otherwise Covi derives one. */
export const DemoPlanSchema = z.strictObject({
  pages: z.array(z.string()).default([]),
  flows: z.array(FlowSchema).default([]),
  commands: z.array(DemoCommandSchema).default([]),
  requests: z.array(DemoRequestSchema).default([]),
  viewports: z.array(z.enum(VIEWPORTS)).optional(),
  notes: z.string().optional(),
});

export type DemoPlan = z.output<typeof DemoPlanSchema>;
type Viewport = (typeof VIEWPORTS)[number];

const MAX_PAGES = 4;
const MAX_REQUESTS = 4;

export function planDemo(
  context: ReviewContext,
  config: CoviConfig,
  authored?: unknown,
  subject?: Subject,
): DemoPlan & { viewports: Viewport[]; proposed: string[] } {
  const plan = authored
    ? parseOrThrow(
        DemoPlanSchema,
        authored,
        'demo/plan.json',
        'Run `covi schema demo-plan` for the format.',
      )
    : DemoPlanSchema.parse({});
  const pages = [
    ...new Set([
      ...plan.pages,
      ...config.demo.pages,
      ...context.demonstration.candidates.filter((c) => c.kind === 'ui').map((c) => c.target),
    ]),
  ];
  const requests = [...plan.requests, ...config.demo.requests];
  for (const c of context.demonstration.candidates.filter((x) => x.kind === 'api')) {
    const path = c.target.replace(/^GET\s+/, '');
    // Only parameter-free GET routes are safe and meaningful to call without configuration.
    if (/[:[{*]/.test(path) || requests.some((r) => r.path === path)) continue;
    requests.push({ name: `GET ${path}`, method: 'GET', path, compare: true });
  }
  const flowNames = new Set<string>();
  const flows = [...plan.flows, ...config.demo.flows].filter(
    (f) => !flowNames.has(f.name) && flowNames.add(f.name),
  );
  const commandNames = new Set<string>();
  const commands = [...plan.commands, ...config.demo.commands].filter(
    (c) => !commandNames.has(c.name) && commandNames.add(c.name),
  );
  const captured = pages.slice(0, MAX_PAGES);
  const viewports = plan.viewports ?? config.demo.viewports;
  // Flows named anywhere, even an empty list in the plan, are followed as written; otherwise the
  // flows that passed before on the pages this run captures are replayed, step for step.
  const named =
    flows.length > 0 || (typeof authored === 'object' && authored !== null && 'flows' in authored);
  const proposed = !named && subject ? proposeFlows(subject, captured, viewports) : [];
  return {
    pages: captured,
    flows: [...flows, ...proposed],
    commands,
    requests: requests.slice(0, MAX_REQUESTS),
    viewports,
    notes: plan.notes,
    proposed: proposed.map((f) => f.name),
  };
}

/** At most this many flows are replayed from the subject model in one run. */
export const MAX_PROPOSED_FLOWS = 2;

/**
 * Flows from the subject model worth replaying for these pages: ones that passed within the
 * model's revisions and start on a planned page, most recently passed first. The steps are the
 * ones that passed, never new ones: Covi does not invent interactions, and the model holds no
 * commands to propose.
 */
export function proposeFlows(
  subject: Subject,
  pages: readonly string[],
  viewports: readonly Viewport[],
): Flow[] {
  const planned = new Set(pages.map(screenPath));
  const age = (revision: string) => subject.revisions.indexOf(revision);
  return subject.flows
    .filter((f) => planned.has(screenPath(f.path)) && age(f.passed) >= 0)
    .sort((a, b) => age(a.passed) - age(b.passed) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, MAX_PROPOSED_FLOWS)
    .map((f) => ({
      name: f.name,
      path: f.path,
      steps: f.steps.map((s) => s.action),
      ...(viewports.includes(f.viewport) ? { viewports: [f.viewport] } : {}),
    }));
}

/**
 * Where a flow runs: at its own first viewport, else at the one the result will mostly be seen at
 * (mobile for a vertical video) when the plan captures it, else at the plan's first.
 */
export function flowViewport(
  flow: Pick<Flow, 'viewports'>,
  viewports: readonly Viewport[],
  prefer?: Viewport,
): Viewport {
  if (flow.viewports?.[0]) return flow.viewports[0];
  if (prefer && viewports.includes(prefer)) return prefer;
  return viewports[0] ?? 'desktop';
}
