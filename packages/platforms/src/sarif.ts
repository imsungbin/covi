import { type Finding, type Language, t } from '@covi/core';

const LEVEL: Record<Finding['severity'], 'error' | 'warning' | 'note'> = {
  high: 'error',
  medium: 'warning',
  low: 'note',
};

/** SARIF 2.1.0 for code-scanning tools (GitHub code scanning, IDE viewers). */
export function toSarif(
  findings: readonly Finding[],
  version: string,
  language: Language = 'en',
): object {
  const rules = new Map<string, { id: string; name: string; shortDescription: { text: string } }>();
  for (const f of findings) {
    const id = f.source.id ?? `${f.source.kind}-${f.category}`;
    if (!rules.has(id)) rules.set(id, { id, name: id, shortDescription: { text: f.category } });
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Covi',
            version,
            rules: [...rules.values()],
          },
        },
        results: findings.map((f) => ({
          ruleId: f.source.id ?? `${f.source.kind}-${f.category}`,
          level: f.certainty === 'question' ? 'note' : LEVEL[f.severity],
          message: {
            text: `${t(language, `certainty.${f.certainty}`)}: ${f.title}. ${f.explanation}`,
          },
          partialFingerprints: { coviFindingId: f.id },
          locations: f.location
            ? [
                {
                  physicalLocation: {
                    artifactLocation: { uri: f.location.path },
                    region: {
                      startLine: f.location.line ?? 1,
                      ...(f.location.endLine ? { endLine: f.location.endLine } : {}),
                    },
                  },
                },
              ]
            : [],
        })),
      },
    ],
  };
}
