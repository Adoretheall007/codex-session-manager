import type { SessionFilterState, SessionSummary } from "../types";

export function filterSessions(
  sessions: SessionSummary[],
  filters: SessionFilterState
): SessionSummary[] {
  const query = filters.query.trim().toLowerCase();
  const cwdQuery = filters.cwdQuery.trim().toLowerCase();
  return sessions.filter((session) => {
    if (filters.onlyLargeFiles && session.size < 10 * 1024 * 1024) {
      return false;
    }
    if (cwdQuery && !session.cwd.toLowerCase().includes(cwdQuery)) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      session.fileName,
      session.title,
      session.cwd,
      session.model,
      session.id
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}
