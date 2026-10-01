/** Returns a complete user-selected ordering, rejecting incomplete reorders. */
export function orderByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (ids.length !== items.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
    throw new Error("The task order no longer matches the configured tasks. Refresh and try again.");
  }
  return ids.map((id) => byId.get(id)!);
}
