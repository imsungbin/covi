/** A file-name-safe id from a URL path or a flow name. */
export function slug(text: string): string {
  return (
    text
      .replace(/^\/+/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'home'
  );
}

/** Ids made unique in order: a second `flow-post` becomes `flow-post-2`, so files never collide. */
export function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.map((id) => {
    let unique = id;
    for (let n = 2; seen.has(unique); n++) unique = `${id}-${n}`;
    seen.add(unique);
    return unique;
  });
}

/** A flow's scenario id; flow shots and frames already start with it. */
export const flowScenario = (name: string) => `flow-${slug(name)}`;

/** A page's scenario id at one viewport; the same as its shot id. */
export const pageScenario = (path: string, viewport: string) => `${slug(path)}-${viewport}`;
