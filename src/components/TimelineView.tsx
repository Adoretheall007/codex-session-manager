import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDateLabel } from "../lib/format";
import type { SessionDetails, TimelineEntry } from "../types";

type TimelineViewProps = {
  details: SessionDetails | null;
  loading: boolean;
  error: string | null;
  hideFoldedContent?: boolean;
};

type FoldEntry = {
  id: string;
  timestamp: string;
  summary: string;
  details: string;
};

type DisplayItem = {
  type: "message" | "fold_group";
  id: string;
  kind: TimelineEntry["kind"];
  label: string;
  timestamp: string;
  summary: string;
  details: string;
  entries?: FoldEntry[];
};

type TurnRenderItem =
  | {
      type: "message";
      item: DisplayItem;
    }
  | {
      type: "fold_block";
      id: string;
      startedAt: string;
      count: number;
      items: DisplayItem[];
    };

type AuxiliaryDialogSection = {
  id: string;
  label: string;
  summary: string;
  timestamp: string;
  entries: FoldEntry[];
};

type ActiveAuxiliaryDialog = {
  id: string;
  label: string;
  timestamp: string;
  count: number;
  sections: AuxiliaryDialogSection[];
};

type MessageBodyParts = {
  body: string;
  citation: string | null;
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
    const isPreludeTurn = turn.id === "prelude";

    for (const entry of turn.entries) {
      if (
        (entry.kind === "user_message" || entry.kind === "assistant_message") &&
        !isPreludeTurn
      ) {
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
      const entryDetails = entry.details || entry.preview || "无详细内容";
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
          details: entryDetails
        });
        lastItem.summary =
          lastItem.entries.length === 1
            ? lastItem.entries[0].summary
            : `${lastItem.entries.length} 条同类记录`;
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
        details: entryDetails,
        entries: [
          {
            id: entry.id,
            timestamp: entry.timestamp,
            summary,
            details: entryDetails
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

function buildTurnRenderItems(items: DisplayItem[]): TurnRenderItem[] {
  const renderItems: TurnRenderItem[] = [];
  let pendingFoldItems: DisplayItem[] = [];

  const flushPendingFoldItems = () => {
    if (pendingFoldItems.length === 0) {
      return;
    }

    renderItems.push({
      type: "fold_block",
      id:
        pendingFoldItems.length === 1
          ? `fold-block-${pendingFoldItems[0].id}`
          : `fold-block-${pendingFoldItems[0].id}-${pendingFoldItems[pendingFoldItems.length - 1].id}`,
      startedAt: pendingFoldItems[0].timestamp,
      count: pendingFoldItems.length,
      items: pendingFoldItems
    });

    pendingFoldItems = [];
  };

  for (const item of items) {
    if (item.type === "message") {
      flushPendingFoldItems();
      renderItems.push({
        type: "message",
        item
      });
      continue;
    }

    pendingFoldItems.push(item);
  }

  flushPendingFoldItems();
  return renderItems;
}

function splitMessageBody(text: string): MessageBodyParts {
  const marker = "<oai-mem-citation>";
  const start = text.indexOf(marker);

  if (start === -1) {
    return {
      body: text.trim(),
      citation: null
    };
  }

  return {
    body: text.slice(0, start).trim(),
    citation: text.slice(start).trim()
  };
}

function MessageMarkdownBody({ text }: { text: string }) {
  if (!text.trim()) {
    return null;
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="chat-paragraph">{children}</p>,
        ul: ({ children }) => <ul className="chat-list">{children}</ul>,
        ol: ({ children }) => <ol className="chat-ordered-list">{children}</ol>,
        li: ({ children }) => <li className="chat-list-item">{children}</li>,
        a: ({ children, href }) => {
          const target = href ?? "";
          const isWebLink = /^https?:\/\//i.test(target);

          if (isWebLink) {
            return (
              <a className="chat-inline-link" href={target} rel="noreferrer" target="_blank">
                {children}
              </a>
            );
          }

          return (
            <span className="chat-inline-link" title={target}>
              {children}
            </span>
          );
        },
        code: ({ children, className }) => {
          const isBlock = Boolean(className);
          if (isBlock) {
            return <code className={className}>{children}</code>;
          }
          return <code className="chat-inline-code">{children}</code>;
        },
        pre: ({ children }) => <pre className="chat-code-block">{children}</pre>
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function MessageBubble({
  activeAuxiliaryId,
  item,
  onOpenAuxiliaryDialog
}: {
  activeAuxiliaryId: string | null;
  item: DisplayItem;
  onOpenAuxiliaryDialog: (item: ActiveAuxiliaryDialog) => void;
}) {
  const sideClass = item.kind === "user_message" ? "chat-user" : "chat-assistant";
  const { body, citation } = splitMessageBody(item.details);

  return (
    <article className={`chat-message ${sideClass}`}>
      <div className={`chat-card ${kindClass(item.kind)}`}>
        <div className="chat-card-meta">
          <span className="chat-role">{item.label}</span>
          <span className="chat-time">{formatDateLabel(item.timestamp)}</span>
        </div>
        <div className="chat-body">
          <MessageMarkdownBody text={body} />
        </div>
      </div>
      {citation ? (
        <AuxiliarySummaryRow
          activeAuxiliaryId={activeAuxiliaryId}
          count={1}
          dialogId={`citation-${item.id}`}
          label="引用信息"
          onOpen={() =>
            onOpenAuxiliaryDialog({
              id: `citation-${item.id}`,
              label: "引用信息",
              timestamp: item.timestamp,
              count: 1,
              sections: [
                {
                  id: `citation-section-${item.id}`,
                  label: "memory citation",
                  summary: "1 条引用信息",
                  timestamp: item.timestamp,
                  entries: [
                    {
                      id: `citation-entry-${item.id}`,
                      timestamp: item.timestamp,
                      summary: "<oai-mem-citation>",
                      details: citation
                    }
                  ]
                }
              ]
            })
          }
          summary="1 条引用信息"
          timestamp={item.timestamp}
        />
      ) : null}
    </article>
  );
}

function AuxiliarySummaryRow({
  activeAuxiliaryId,
  count,
  dialogId,
  label = "辅助记录",
  summary,
  timestamp,
  onOpen
}: {
  activeAuxiliaryId: string | null;
  count: number;
  dialogId: string;
  label?: string;
  summary: string;
  timestamp: string;
  onOpen: () => void;
}) {
  return (
    <div className="auxiliary-trigger-row">
      <button
        className={`auxiliary-trigger${activeAuxiliaryId === dialogId ? " active" : ""}`}
        type="button"
        onClick={onOpen}
      >
        <span className="auxiliary-trigger-text">{label}</span>
        <span className="auxiliary-trigger-count">{count} 项</span>
        <span className="auxiliary-trigger-summary">{summary}</span>
        <span className="auxiliary-trigger-time">{formatDateLabel(timestamp)}</span>
        <span className="auxiliary-trigger-arrow" aria-hidden="true">›</span>
      </button>
    </div>
  );
}

function FoldBlock({
  activeAuxiliaryId,
  item,
  onOpenAuxiliaryDialog
}: {
  activeAuxiliaryId: string | null;
  item: Extract<TurnRenderItem, { type: "fold_block" }>;
  onOpenAuxiliaryDialog: (item: ActiveAuxiliaryDialog) => void;
}) {
  const sections = item.items.map((childItem) => ({
    id: childItem.id,
    label: childItem.label,
    summary: childItem.summary,
    timestamp: childItem.timestamp,
    entries:
      childItem.entries ?? [
        {
          id: childItem.id,
          timestamp: childItem.timestamp,
          summary: childItem.summary,
          details: childItem.details
        }
      ]
  }));

  return (
    <section className="fold-block">
      <AuxiliarySummaryRow
        activeAuxiliaryId={activeAuxiliaryId}
        count={item.count}
        dialogId={item.id}
        onOpen={() =>
          onOpenAuxiliaryDialog({
            id: item.id,
            label: "辅助记录",
            timestamp: item.startedAt,
            count: item.count,
            sections
          })
        }
        summary={item.count === 1 ? "1 条辅助记录" : `${item.count} 条辅助记录`}
        timestamp={item.startedAt}
      />
    </section>
  );
}

function AuxiliaryDialog({
  activeItem,
  onClose
}: {
  activeItem: ActiveAuxiliaryDialog | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!activeItem) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeItem, onClose]);

  if (!activeItem) {
    return null;
  }

  return (
    <div className="auxiliary-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="auxiliary-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="auxiliary-dialog-header">
          <div className="auxiliary-dialog-head">
            <span className="auxiliary-dialog-label">{activeItem.label}</span>
            <span className="auxiliary-dialog-count">{activeItem.count} 项</span>
          </div>
          <span className="auxiliary-dialog-time">{formatDateLabel(activeItem.timestamp)}</span>
        </div>
        <div className="auxiliary-dialog-body">
          {activeItem.sections.map((section) => (
            <section className="auxiliary-dialog-section" key={section.id}>
              <div className="auxiliary-dialog-section-header">
                <div className="auxiliary-dialog-section-head">
                  <span className="auxiliary-dialog-section-label">{section.label}</span>
                  {section.entries.length > 1 ? (
                    <span className="auxiliary-dialog-section-count">{section.entries.length}</span>
                  ) : null}
                </div>
                <span>{formatDateLabel(section.timestamp)}</span>
              </div>
              <div className="auxiliary-dialog-section-summary">{section.summary}</div>
              {section.entries.map((entry, index) => (
                <AuxiliaryDialogEntry
                  entry={entry}
                  index={index}
                  key={entry.id}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuxiliaryDialogEntry({
  entry,
  index
}: {
  entry: FoldEntry;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className={`auxiliary-dialog-entry${expanded ? " expanded" : ""}`}>
      <button
        className="auxiliary-dialog-entry-toggle"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="auxiliary-dialog-entry-meta">
          <span className="auxiliary-dialog-entry-index">#{index + 1}</span>
          <span>{formatDateLabel(entry.timestamp)}</span>
        </div>
        <div className="auxiliary-dialog-entry-summary">{entry.summary}</div>
        <span className="auxiliary-dialog-entry-arrow" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded ? <pre className="auxiliary-dialog-entry-details">{entry.details}</pre> : null}
    </section>
  );
}

function TurnSection({
  activeAuxiliaryId,
  hideFoldedContent,
  onOpenAuxiliaryDialog,
  turn
}: {
  activeAuxiliaryId: string | null;
  hideFoldedContent: boolean;
  onOpenAuxiliaryDialog: (item: ActiveAuxiliaryDialog) => void;
  turn: ReturnType<typeof buildDisplayItems>[number];
}) {
  const isPreludeTurn = turn.turnId === "prelude";
  const visibleItems = hideFoldedContent
    ? turn.items.filter((item) => item.type === "message")
    : turn.items;
  const renderItems = buildTurnRenderItems(visibleItems);
  const collapsibleFoldOnly =
    !isPreludeTurn &&
    visibleItems.length > 1 &&
    visibleItems.every((item) => item.type === "fold_group");
  const [expanded, setExpanded] = useState(() => !collapsibleFoldOnly);

  if (isPreludeTurn && visibleItems.length === 0) {
    return null;
  }

  if (!isPreludeTurn && renderItems.length === 0) {
    return null;
  }

  return (
    <section className="turn-section">
      {!isPreludeTurn && collapsibleFoldOnly ? (
        <button
          className="turn-divider turn-divider-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <strong>{turn.turnLabel}</strong>
          <span>{formatDateLabel(turn.turnStartedAt)}</span>
          <span>{visibleItems.length} 项</span>
          <span className="turn-divider-arrow" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
        </button>
      ) : !isPreludeTurn ? (
        <div className="turn-divider">
          <strong>{turn.turnLabel}</strong>
          <span>{formatDateLabel(turn.turnStartedAt)}</span>
        </div>
      ) : null}

      {!collapsibleFoldOnly || expanded ? (
        <div className={`turn-stack${collapsibleFoldOnly ? " turn-stack-scrollable" : ""}`}>
          {renderItems.map((item) => {
            if (item.type === "message") {
              return isPreludeTurn ? null : (
                <MessageBubble
                  activeAuxiliaryId={activeAuxiliaryId}
                  item={item.item}
                  key={item.item.id}
                  onOpenAuxiliaryDialog={onOpenAuxiliaryDialog}
                />
              );
            }

            return (
              <FoldBlock
                activeAuxiliaryId={activeAuxiliaryId}
                item={item}
                key={item.id}
                onOpenAuxiliaryDialog={onOpenAuxiliaryDialog}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function TimelineViewInner(props: TimelineViewProps) {
  const [activeAuxiliaryDialog, setActiveAuxiliaryDialog] =
    useState<ActiveAuxiliaryDialog | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const previousMetricsRef = useRef<{
    detailsId: string | null;
    totalEntries: number;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    const container = timelineScrollRef.current;
    if (!container) {
      return;
    }

    const previousMetrics = previousMetricsRef.current;
    const currentDetailsId = props.details?.summary.id ?? null;
    const currentTotalEntries = props.details?.totalEntries ?? 0;

    if (
      props.details &&
      previousMetrics &&
      previousMetrics.detailsId === currentDetailsId &&
      currentTotalEntries >= previousMetrics.totalEntries
    ) {
      const heightDelta = container.scrollHeight - previousMetrics.scrollHeight;
      container.scrollTop = Math.max(0, previousMetrics.scrollTop + heightDelta);
    }

    previousMetricsRef.current = {
      detailsId: currentDetailsId,
      totalEntries: currentTotalEntries,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight
    };
  }, [props.details]);

  const handleTimelineScroll = () => {
    const container = timelineScrollRef.current;
    if (!container) {
      return;
    }

    previousMetricsRef.current = {
      detailsId: props.details?.summary.id ?? null,
      totalEntries: props.details?.totalEntries ?? 0,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight
    };
  };

  useEffect(() => {
    setActiveAuxiliaryDialog(null);
  }, [props.details]);

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
  const hideFoldedContent = props.hideFoldedContent ?? false;

  return (
    <main className="main-panel">
      <div className="timeline-scroll" onScroll={handleTimelineScroll} ref={timelineScrollRef}>
        {groupedTurns.map((turn) => (
          <TurnSection
            activeAuxiliaryId={activeAuxiliaryDialog?.id ?? null}
            hideFoldedContent={hideFoldedContent}
            key={turn.turnId}
            onOpenAuxiliaryDialog={setActiveAuxiliaryDialog}
            turn={turn}
          />
        ))}
      </div>

      <AuxiliaryDialog
        activeItem={activeAuxiliaryDialog}
        onClose={() => setActiveAuxiliaryDialog(null)}
      />
    </main>
  );
}

export const TimelineView = memo(TimelineViewInner);
