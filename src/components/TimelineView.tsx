import { useState } from "react";
import { formatCount, formatDateLabel } from "../lib/format";
import type { SessionDetails, TimelineEntry } from "../types";

type TimelineViewProps = {
  details: SessionDetails | null;
  loading: boolean;
  error: string | null;
};

function kindClass(kind: TimelineEntry["kind"]): string {
  switch (kind) {
    case "user_message":
      return "kind-user";
    case "assistant_message":
      return "kind-assistant";
    case "system_message":
      return "kind-system";
    case "tool_call_group":
      return "kind-tool";
    case "tool_output_group":
      return "kind-output";
    case "reasoning_group":
      return "kind-reasoning";
    case "event":
      return "kind-event";
    case "meta":
      return "kind-meta";
    default:
      return "";
  }
}

function isConversationEntry(entry: TimelineEntry) {
  return entry.kind === "user_message" || entry.kind === "assistant_message";
}

function roleLabel(entry: TimelineEntry) {
  if (entry.kind === "user_message") {
    return "用户";
  }
  if (entry.kind === "assistant_message") {
    return "Codex";
  }
  return entry.title;
}

function ConversationMessage({ entry }: { entry: TimelineEntry }) {
  const sideClass = entry.kind === "user_message" ? "chat-user" : "chat-assistant";
  const body = entry.details || entry.preview || entry.summary || "空消息";

  return (
    <article className={`chat-message ${sideClass}`}>
      <div className={`chat-card ${kindClass(entry.kind)}`}>
        <div className="chat-card-meta">
          <span className="chat-role">{roleLabel(entry)}</span>
          <span className="chat-time">{formatDateLabel(entry.timestamp)}</span>
        </div>
        <div className="chat-body">{body}</div>
      </div>
    </article>
  );
}

function FoldedEntry({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  const summary = entry.summary || entry.preview || "无摘要";
  const details = entry.details || entry.preview || "无详细内容";

  return (
    <section className={`folded-entry ${kindClass(entry.kind)}${expanded ? " expanded" : ""}`}>
      <button className="folded-entry-toggle" onClick={() => setExpanded((value) => !value)}>
        <div className="folded-entry-main">
          <strong>{entry.title}</strong>
          <p>{summary}</p>
        </div>
        <div className="folded-entry-meta">
          <span>{formatDateLabel(entry.timestamp)}</span>
          <span>{expanded ? "收起详情" : "展开详情"}</span>
        </div>
      </button>
      {expanded ? <pre className="folded-entry-details">{details}</pre> : null}
    </section>
  );
}

export function TimelineView(props: TimelineViewProps) {
  if (props.loading) {
    return (
      <main className="main-panel centered-panel">
        <p>正在加载会话详情…</p>
      </main>
    );
  }

  if (props.error) {
    return (
      <main className="main-panel centered-panel">
        <p className="error-text">{props.error}</p>
      </main>
    );
  }

  if (!props.details) {
    return (
      <main className="main-panel centered-panel">
        <p>从左侧选择一个会话开始浏览。</p>
      </main>
    );
  }

  return (
    <main className="main-panel">
      <header className="detail-header">
        <div>
          <h2>{props.details.summary.title || props.details.summary.fileName}</h2>
          <p>{props.details.summary.cwd || "未知 cwd"}</p>
        </div>
        <div className="detail-stats">
          <span>{formatCount(props.details.summary.turnCount)} 轮</span>
          <span>{formatCount(props.details.summary.messageCount)} 条对话</span>
          <span>{formatCount(props.details.totalEntries)} 条总记录</span>
          <span>{props.details.summary.model || "未知模型"}</span>
        </div>
      </header>

      <div className="timeline-scroll">
        {props.details.turns.map((turn) => (
          <section className="turn-section" key={turn.id}>
            <div className="turn-divider">
              <strong>{turn.label}</strong>
              <span>{formatDateLabel(turn.startedAt)}</span>
            </div>
            <div className="turn-stack">
              {turn.entries.map((entry) =>
                isConversationEntry(entry) ? (
                  <ConversationMessage entry={entry} key={entry.id} />
                ) : (
                  <FoldedEntry entry={entry} key={entry.id} />
                )
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
