import {
  type CoviConfig,
  DemoCommandSchema,
  DemoRequestSchema,
  FlowSchema,
  parseOrThrow,
  type ReviewContext,
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

const MAX_PAGES = 4;
const MAX_REQUESTS = 4;

export function planDemo(
  context: ReviewContext,
  config: CoviConfig,
  authored?: unknown,
): DemoPlan & { viewports: Array<(typeof VIEWPORTS)[number]> } {
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
  return {
    pages: pages.slice(0, MAX_PAGES),
    flows,
    commands,
    requests: requests.slice(0, MAX_REQUESTS),
    viewports: plan.viewports ?? config.demo.viewports,
    notes: plan.notes,
  };
}
