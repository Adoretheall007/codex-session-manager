import type { SessionFilterState, SessionSummary } from "../types";

export function filterSessions(
  sessions: SessionSummary[],
  filters: SessionFilterState
): SessionSummary[] {
  const query = filters.query.trim().toLowerCase();
  const filtered = sessions.filter((session) => {
    if (filters.onlyLargeFiles && session.size < 10 * 1024 * 1024) {
      return false;
    }
    if (!query) {
      return true;
    }
    return session.searchText.includes(query);
  });

  if (filters.sortBy === "recent_activity") {
    filtered.sort((left, right) =>
      (right.lastTimestamp || right.dateLabel).localeCompare(left.lastTimestamp || left.dateLabel)
    );
  }

  return filtered;
}
