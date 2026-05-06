import { formatCount, formatDateLabel, formatFileSize } from "../lib/format";
import type { SessionFilterState, SessionSummary } from "../types";

type SessionListProps = {
  sessions: SessionSummary[];
  selectedId: string | null;
  filters: SessionFilterState;
  onSelect: (session: SessionSummary) => void;
  onFilterChange: (next: SessionFilterState) => void;
};

export function SessionList(props: SessionListProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>会话列表</h2>
        <p>{formatCount(props.sessions.length)} 个会话</p>
      </div>

      <div className="filters">
        <input
          className="filter-input"
          placeholder="搜索标题、cwd、模型"
          value={props.filters.query}
          onChange={(event) =>
            props.onFilterChange({ ...props.filters, query: event.target.value })
          }
        />
        <input
          className="filter-input"
          placeholder="过滤 cwd"
          value={props.filters.cwdQuery}
          onChange={(event) =>
            props.onFilterChange({ ...props.filters, cwdQuery: event.target.value })
          }
        />
        <label className="checkbox-row">
          <input
            checked={props.filters.onlyLargeFiles}
            type="checkbox"
            onChange={(event) =>
              props.onFilterChange({
                ...props.filters,
                onlyLargeFiles: event.target.checked
              })
            }
          />
          只看 10MB 以上
        </label>
      </div>

      <div className="session-list">
        {props.sessions.map((session) => {
          const selected = session.id === props.selectedId;
          return (
            <button
              key={session.id}
              className={`session-card${selected ? " selected" : ""}`}
              onClick={() => props.onSelect(session)}
            >
              <div className="session-card-top">
                <strong>{session.title || session.fileName}</strong>
                <span>{formatFileSize(session.size)}</span>
              </div>
              <p className="session-path">{session.cwd || "未知 cwd"}</p>
              <div className="session-metrics">
                <span>{formatDateLabel(session.lastTimestamp || session.dateLabel)}</span>
                <span>{formatCount(session.turnCount)} 轮</span>
                <span>{formatCount(session.messageCount)} 消息</span>
              </div>
              <div className="session-metrics">
                <span>U {formatCount(session.userMessageCount)}</span>
                <span>A {formatCount(session.assistantMessageCount)}</span>
                <span>T {formatCount(session.toolCallCount)}</span>
                <span>R {formatCount(session.reasoningCount)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
