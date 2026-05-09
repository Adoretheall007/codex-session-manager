import { memo, useEffect, useState } from "react";
import { formatCount, formatDateLabel, formatFileSize } from "../lib/format";
import type { SessionFilterState, SessionSummary } from "../types";

type SessionListProps = {
  sessions: SessionSummary[];
  selectedId: string | null;
  selectedForDeleteIds: Set<string>;
  refreshingSessionId: string | null;
  filters: SessionFilterState;
  batchDeleteCountdown: number | null;
  batchDeleteReady: boolean;
  deletingSessions: boolean;
  totalSelectedForDelete: number;
  onSelect: (session: SessionSummary) => void;
  onToggleSessionSelection: (sessionId: string) => void;
  onClearSelection: () => void;
  onFilterChange: (next: SessionFilterState) => void;
  directoryPath: string;
  directoryStatusText: string;
  onRefresh: () => void;
  onRefreshSession: (session: SessionSummary) => void;
  onRequestBatchDelete: () => void;
  onPickDirectory: () => void;
};

export function SessionList(props: SessionListProps) {
  const [queryInput, setQueryInput] = useState(props.filters.query);
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);

  useEffect(() => {
    setQueryInput(props.filters.query);
  }, [props.filters.query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (queryInput !== props.filters.query) {
        props.onFilterChange({ ...props.filters, query: queryInput });
      }
    }, 160);

    return () => window.clearTimeout(timer);
  }, [props.filters, props.onFilterChange, queryInput]);

  useEffect(() => {
    if (!copiedSessionId) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopiedSessionId(null);
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [copiedSessionId]);

  async function handleCopyResume(session: SessionSummary) {
    try {
      await navigator.clipboard.writeText(session.resume);
      setCopiedSessionId(session.id);
    } catch {
      setCopiedSessionId(null);
    }
  }

  const hasBatchSelection = props.totalSelectedForDelete > 0;
  const batchDeleteLabel = props.deletingSessions
    ? "删除中..."
    : props.batchDeleteCountdown != null
      ? `等待 ${props.batchDeleteCountdown}s`
      : props.batchDeleteReady
        ? `确认删除 ${props.totalSelectedForDelete} 项`
        : `批量删除 ${props.totalSelectedForDelete} 项`;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <h2>会话列表</h2>
          <span className="sidebar-count-badge">{formatCount(props.sessions.length)} 个</span>
        </div>
        <div className="sidebar-toolbar">
          <div className="sidebar-toolbar-row">
            <div className="sidebar-toolbar-path" title={props.directoryPath}>
              <span className="sidebar-toolbar-path-icon">⌂</span>
              <span>{props.directoryPath}</span>
            </div>
            <div className="sidebar-toolbar-status">{props.directoryStatusText}</div>
          </div>
          <div className="sidebar-toolbar-actions">
            <button className="secondary-button" onClick={props.onRefresh} type="button">
              刷新
            </button>
            <button className="secondary-button" onClick={props.onPickDirectory} type="button">
              切换目录
            </button>
          </div>
        </div>
      </div>

      <div className="filters">
        <div className="filter-primary-row">
          <select
            className="filter-input filter-select filter-select-compact"
            value={props.filters.sortBy}
            onChange={(event) =>
              props.onFilterChange({
                ...props.filters,
                sortBy: event.target.value as SessionFilterState["sortBy"]
              })
            }
          >
            <option value="recent_activity">最近活跃</option>
          </select>
          <input
            className="filter-input"
            placeholder="搜索标题、目录、模型、resume"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
          />
        </div>
        <div className="filter-toggle-row">
          <label
            className={`checkbox-row${props.filters.onlyLargeFiles ? " checked" : ""}`}
          >
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
            <span className="checkbox-indicator" aria-hidden="true">
              {props.filters.onlyLargeFiles ? "✓" : ""}
            </span>
            <span className="checkbox-copy">
              <strong>大文件</strong>
              <small>只看 10MB 以上</small>
            </span>
          </label>
          <label
            className={`checkbox-row${props.filters.hideFoldedContent ? " checked" : ""}`}
          >
            <input
              checked={props.filters.hideFoldedContent}
              type="checkbox"
              onChange={(event) =>
                props.onFilterChange({
                  ...props.filters,
                  hideFoldedContent: event.target.checked
                })
              }
            />
            <span className="checkbox-indicator" aria-hidden="true">
              {props.filters.hideFoldedContent ? "✓" : ""}
            </span>
            <span className="checkbox-copy">
              <strong>纯对话</strong>
              <small>隐藏折叠内容</small>
            </span>
          </label>
        </div>
        {hasBatchSelection ? (
          <div className="batch-delete-bar">
            <div className="batch-delete-copy">
              <strong>已选择 {props.totalSelectedForDelete} 个会话</strong>
              <small>
                {props.batchDeleteReady
                  ? "倒计时结束，再次点击确认删除"
                  : props.batchDeleteCountdown != null
                    ? "删除确认倒计时中"
                    : "删除的是本地 JSONL 文件"}
              </small>
            </div>
            <div className="batch-delete-actions">
              <button
                className="danger-button"
                disabled={props.deletingSessions || props.batchDeleteCountdown != null}
                onClick={props.onRequestBatchDelete}
                type="button"
              >
                {batchDeleteLabel}
              </button>
              <button
                className="secondary-button batch-clear-button"
                disabled={props.deletingSessions}
                onClick={props.onClearSelection}
                type="button"
              >
                清空
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="session-list">
        {props.sessions.map((session) => {
          const selected = session.id === props.selectedId;
          const selectedForDelete = props.selectedForDeleteIds.has(session.id);
          const copied = copiedSessionId === session.id;
          const refreshing = props.refreshingSessionId === session.id;

          return (
            <article
              aria-selected={selected}
              className={`session-card${selected ? " selected" : ""}${selectedForDelete ? " marked-for-delete" : ""}`}
              key={session.id}
              onClick={() => props.onSelect(session)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onSelect(session);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="session-card-top">
                <button
                  aria-label={`${selectedForDelete ? "取消选择" : "选择"}会话 ${session.title || session.fileName}`}
                  aria-pressed={selectedForDelete}
                  className={`session-select-button${selectedForDelete ? " checked" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onToggleSessionSelection(session.id);
                  }}
                  title={selectedForDelete ? "取消批量删除选择" : "选择用于批量删除"}
                  type="button"
                >
                  {selectedForDelete ? "✓" : ""}
                </button>
                <strong title={session.title || session.fileName}>{session.title || session.fileName}</strong>
                <div className="session-card-actions">
                  <span>{formatFileSize(session.size)}</span>
                  <button
                    aria-label={`刷新会话 ${session.title || session.fileName}`}
                    className={`session-icon-button${refreshing ? " is-loading" : ""}`}
                    disabled={refreshing}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onRefreshSession(session);
                    }}
                    title={refreshing ? "正在刷新会话" : "刷新这个会话"}
                    type="button"
                  >
                    <span aria-hidden="true">{refreshing ? "…" : "↻"}</span>
                  </button>
                </div>
              </div>
              <p className="session-path">{session.cwd || "未知 cwd"}</p>
              <div className="session-resume">
                <span className="session-resume-label">resume</span>
                <span className="session-resume-text" title={session.resume}>
                  {session.resume}
                </span>
                <button
                  className="session-copy-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleCopyResume(session);
                  }}
                  type="button"
                >
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
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
            </article>
          );
        })}
      </div>
    </aside>
  );
}

export const MemoSessionList = memo(SessionList);
