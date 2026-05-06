import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatCount, formatDateLabel } from "../lib/format";
import type { SessionDetails, TimelineEntry } from "../types";

type TimelineViewProps = {
  details: SessionDetails | null;
  loading: boolean;
  error: string | null;
};

type Row =
  | { type: "turn"; id: string; title: string; startedAt: string }
  | { type: "entry"; id: string; entry: TimelineEntry };

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

function EntryCard({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(!entry.collapsedByDefault);
  return (
    <section className={`timeline-entry ${kindClass(entry.kind)}`}>
      <button className="entry-header" onClick={() => setExpanded((value) => !value)}>
        <div>
          <strong>{entry.title}</strong>
          <p>{entry.summary}</p>
        </div>
        <div className="entry-meta">
          <span>{formatDateLabel(entry.timestamp)}</span>
          <span>{expanded ? "收起" : "展开"}</span>
        </div>
      </button>
      <div className="entry-preview">{entry.preview || "无预览"}</div>
      {expanded ? <pre className="entry-details">{entry.details || "无详细内容"}</pre> : null}
    </section>
  );
}

export function TimelineView(props: TimelineViewProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!props.details) {
      return [];
    }
    const nextRows: Row[] = [];
    for (const turn of props.details.turns) {
      nextRows.push({
        type: "turn",
        id: `turn-${turn.id}`,
        title: turn.label,
        startedAt: turn.startedAt
      });
      for (const entry of turn.entries) {
        nextRows.push({
          type: "entry",
          id: entry.id,
          entry
        });
      }
    }
    return nextRows;
  }, [props.details]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === "turn" ? 56 : 180),
    overscan: 8
  });

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
          <span>{formatCount(props.details.totalEntries)} 条时间线</span>
          <span>{props.details.summary.model || "未知模型"}</span>
        </div>
      </header>

      <div className="timeline-scroll" ref={parentRef}>
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%"
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={row.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {row.type === "turn" ? (
                  <div className="turn-divider">
                    <strong>{row.title}</strong>
                    <span>{formatDateLabel(row.startedAt)}</span>
                  </div>
                ) : (
                  <EntryCard entry={row.entry} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
