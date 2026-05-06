import { useState } from "react";
import { formatCount, formatDateLabel } from "../lib/format";
import type { SessionDetails, TimelineEntry, TimelineMessageGroup, TimelineKind } from "../types";

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

function isMessageKind(kind: TimelineKind): kind is TimelineMessageGroup["kind"] {
  return kind === "user_message" || kind === "assistant_message" || kind === "system_message";
}

function roleLabel(group: TimelineMessageGroup) {
  if (group.kind === "user_message") {
    return "用户";
  }
  if (group.kind === "assistant_message") {
    return "Codex";
  }
  return group.title;
}

function foldedLabel(entry: TimelineEntry) {
  if (entry.kind === "reasoning_group") {
    return "thinking";
  }
  if (entry.kind === "tool_call_group") {
    return entry.toolName ? `tool · ${entry.toolName}` : "tool call";
  }
  if (entry.kind === "tool_output_group") {
    return entry.toolName ? `tool output · ${entry.toolName}` : "tool output";
  }
  if (entry.kind === "event") {
    return "event";
  }
  if (entry.kind === "meta") {
    return "meta";
  }
  return entry.title;
}

function buildMessageGroups(details: SessionDetails): Array<{
  turnId: string;
  turnLabel: string;
  turnStartedAt: string;
  groups: TimelineMessageGroup[];
}> {
  return details.turns.map((turn) => {
    const groups: TimelineMessageGroup[] = [];
    let assistantBuffer: TimelineMessageGroup | null = null;

    for (const entry of turn.entries) {
      if (isMessageKind(entry.kind)) {
        const nextGroup: TimelineMessageGroup = {
          id: `group-${entry.id}`,
          kind: entry.kind,
          title: entry.title,
          timestamp: entry.timestamp,
          body: entry.details || entry.preview || entry.summary || "空消息",
          entries: [entry],
          collapsedEntries: []
        };
        groups.push(nextGroup);
        assistantBuffer = entry.kind === "assistant_message" ? nextGroup : null;
        continue;
      }

      if (assistantBuffer) {
        assistantBuffer.entries.push(entry);
        assistantBuffer.collapsedEntries.push(entry);
        continue;
      }

      groups.push({
        id: `group-${entry.id}`,
        kind: "system_message",
        title: entry.title,
        timestamp: entry.timestamp,
        body: "",
        entries: [entry],
        collapsedEntries: [entry]
      });
    }

    return {
      turnId: turn.id,
      turnLabel: turn.label,
      turnStartedAt: turn.startedAt,
      groups
    };
  });
}

function FoldedInlineEntry({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  const summary = entry.summary || entry.preview || "无摘要";
  const details = entry.details || entry.preview || "无详细内容";

  return (
    <section className={`inline-fold ${kindClass(entry.kind)}${expanded ? " expanded" : ""}`}>
      <button className="inline-fold-toggle" onClick={() => setExpanded((value) => !value)}>
        <div className="inline-fold-head">
          <span className="inline-fold-label">{foldedLabel(entry)}</span>
          <span className="inline-fold-summary">{summary}</span>
        </div>
        <div className="inline-fold-meta">
          <span>{formatDateLabel(entry.timestamp)}</span>
          <span className="inline-fold-arrow" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
        </div>
      </button>
      {expanded ? <pre className="inline-fold-details">{details}</pre> : null}
    </section>
  );
}

function ConversationGroup({ group }: { group: TimelineMessageGroup }) {
  const sideClass = group.kind === "user_message" ? "chat-user" : "chat-assistant";

  return (
    <article className={`chat-message ${sideClass}`}>
      <div className={`chat-card ${kindClass(group.kind)}`}>
        <div className="chat-card-meta">
          <span className="chat-role">{roleLabel(group)}</span>
          <span className="chat-time">{formatDateLabel(group.timestamp)}</span>
        </div>
        {group.body ? <div className="chat-body">{group.body}</div> : null}
        {group.collapsedEntries.length > 0 ? (
          <div className="chat-inline-stack">
            {group.collapsedEntries.map((entry) => (
              <FoldedInlineEntry entry={entry} key={entry.id} />
            ))}
          </div>
        ) : null}
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

  const groupedTurns = buildMessageGroups(props.details);

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
              {turn.groups.map((group) => (
                <ConversationGroup group={group} key={group.id} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
