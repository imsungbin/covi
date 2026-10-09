/** The document store: the request builder and the reader both look documents up here. */
export function createStore(documents) {
  const byId = new Map(documents.map((d) => [d.id, d]));
  return {
    ids: () => [...byId.keys()],
    get(id) {
      const document = byId.get(id);
      if (!document) throw new Error(`Unknown document: ${id}`);
      return document;
    },
  };
}
