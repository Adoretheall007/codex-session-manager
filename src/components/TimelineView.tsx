import { useState } from "react";
import { formatCount, formatDateLabel } from "../lib/format";
import type { SessionDetails, TimelineEntry } from "../types";

type TimelineViewProps = {
  details: SessionDetails | null;
  loading: boolean;
  error: string | null;
};

type DisplayItem = {
  type: "message" | "fold_group";
  id: string;
  kind: TimelineEntry["kind"];
  label: string;
  timestamp: string;
  summary: string;
  details: string;
  entries?: Array<{
    id: string;
    timestamp: string;
    summary: string;
    details: string;
  }>;
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

function roleLabel(entry: TimelineEntry) {
  if (entry.kind === "user_message") {
    return "用户";
  }
  if (entry.kind === "assistant_message") {
    return "Codex";
  }
  return entry.title;
}

function foldedLabel(entry: TimelineEntry) {
  if (entry.rawType === "turn_context") {
    return "Turn Context";
  }
  if (entry.kind === "reasoning_group") {
    return "Thinking";
  }
  if (entry.kind === "tool_call_group") {
    return entry.toolName ? `Tool · ${entry.toolName}` : "Tool Call";
  }
  if (entry.kind === "tool_output_group") {
    return entry.toolName ? `Tool Output · ${entry.toolName}` : "Tool Output";
  }
  if (entry.kind === "event") {
    return "event_msg";
  }
  if (entry.kind === "meta") {
    return entry.title;
  }
  return entry.title;
}

function buildDisplayItems(details: SessionDetails): Array<{
  turnId: string;
  turnLabel: string;
  turnStartedAt: string;
  items: DisplayItem[];
}> {
  return details.turns.map((turn) => {
    const items: DisplayItem[] = [];

    for (const entry of turn.entries) {
      if (entry.kind === "user_message" || entry.kind === "assistant_message") {
        items.push({
          type: "message",
          id: `item-${entry.id}`,
          kind: entry.kind,
          label: roleLabel(entry),
          timestamp: entry.timestamp,
          summary: entry.summary || entry.preview || "无摘要",
          details: entry.details || entry.preview || "无详细内容"
        });
        continue;
      }

      const label = foldedLabel(entry);
      const summary = entry.summary || entry.preview || "无摘要";
      const details = entry.details || entry.preview || "无详细内容";
      const lastItem = items.at(-1);

      if (
        lastItem &&
        lastItem.type === "fold_group" &&
        lastItem.kind === entry.kind &&
        lastItem.label === label &&
        lastItem.entries
      ) {
        lastItem.entries.push({
          id: entry.id,
          timestamp: entry.timestamp,
          summary,
          details
        });
        lastItem.summary =
          lastItem.entries.length === 1 ? lastItem.entries[0].summary : `${lastItem.entries.length} 条同类记录`;
        lastItem.details = lastItem.entries.map((item) => item.details).join("\n\n");
        continue;
      }

      items.push({
        type: "fold_group",
        id: `item-${entry.id}`,
        kind: entry.kind,
        label,
        timestamp: entry.timestamp,
        summary,
        details,
        entries: [
          {
            id: entry.id,
            timestamp: entry.timestamp,
            summary,
            details
          }
        ]
      });
    }

    return {
      turnId: turn.id,
      turnLabel: turn.label,
      turnStartedAt: turn.startedAt,
      items
    };
  });
}

function FoldedDisplayItem({ item }: { item: DisplayItem }) {
  const [expanded, setExpanded] = useState(false);
  const entries = item.entries ?? [];
  const summaryText =
    entries.length <= 1 ? item.summary : `${entries.length} 条同类记录`;

  return (
    <section className={`inline-fold ${kindClass(item.kind)}${expanded ? " expanded" : ""}`}>
      <button className="inline-fold-toggle" onClick={() => setExpanded((value) => !value)}>
        <div className="inline-fold-head">
          <span className="inline-fold-label">{item.label}</span>
          {entries.length > 1 ? <span className="inline-fold-count">{entries.length}</span> : null}
          <span className="inline-fold-summary">{summaryText}</span>
        </div>
        <div className="inline-fold-meta">
          <span>{formatDateLabel(item.timestamp)}</span>
          <span className="inline-fold-arrow" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
        </div>
      </button>
      {expanded ? (
        <div className="grouped-fold-details">
          {entries.map((entry, index) => (
            <section className="grouped-fold-entry" key={entry.id}>
              <div className="grouped-fold-entry-meta">
                <span className="grouped-fold-entry-index">#{index + 1}</span>
                <span>{formatDateLabel(entry.timestamp)}</span>
              </div>
              <div className="grouped-fold-entry-summary">{entry.summary}</div>
              <pre className="inline-fold-details grouped-fold-entry-body">{entry.details}</pre>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MessageBubble({ item }: { item: DisplayItem }) {
  const sideClass = item.kind === "user_message" ? "chat-user" : "chat-assistant";

  return (
    <article className={`chat-message ${sideClass}`}>
      <div className={`chat-card ${kindClass(item.kind)}`}>
        <div className="chat-card-meta">
          <span className="chat-role">{item.label}</span>
          <span className="chat-time">{formatDateLabel(item.timestamp)}</span>
        </div>
        <div className="chat-body">{item.details}</div>
      </div>
    </article>
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

  const groupedTurns = buildDisplayItems(props.details);

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
        {groupedTurns.map((turn) => (
          <section className="turn-section" key={turn.turnId}>
            <div className="turn-divider">
              <strong>{turn.turnLabel}</strong>
              <span>{formatDateLabel(turn.turnStartedAt)}</span>
            </div>
            <div className="turn-stack">
              {turn.items.map((item) =>
                item.type === "message" ? (
                  <MessageBubble item={item} key={item.id} />
                ) : (
                  <FoldedDisplayItem item={item} key={item.id} />
                )
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
