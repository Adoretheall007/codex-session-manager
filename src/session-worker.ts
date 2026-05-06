import type {
  SessionDetails,
  SessionSummary,
  TimelineEntry,
  TurnGroup,
  WorkerIndexMessage,
  WorkerResponseMessage
} from "./types";
import { clampText } from "./lib/format";

declare const self: DedicatedWorkerGlobalScope;

function postMessageToUi(message: WorkerResponseMessage) {
  self.postMessage(message);
}

async function collectJsonlFiles(
  root: FileSystemDirectoryHandle,
  prefix = ""
): Promise<Array<{ path: string; handle: FileSystemFileHandle }>> {
  const files: Array<{ path: string; handle: FileSystemFileHandle }> = [];
  for await (const [name, handle] of root.entries()) {
    const nextPath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      files.push(...(await collectJsonlFiles(handle, nextPath)));
      continue;
    }
    if (name.endsWith(".jsonl")) {
      files.push({ path: nextPath, handle });
    }
  }
  return files;
}

async function forEachJsonLine(
  file: File,
  onLine: (line: string, index: number) => void | Promise<void>
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = file.stream().getReader();
  let buffer = "";
  let lineIndex = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      if (line) {
        lineIndex += 1;
        await onLine(line, lineIndex);
      }
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  const lastLine = buffer.trim();
  if (lastLine) {
    lineIndex += 1;
    await onLine(lastLine, lineIndex);
  }
}

function parseJsonLine(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function summarizeMessageContent(payload: any): string {
  if (!Array.isArray(payload?.content)) {
    return "";
  }
  const parts = payload.content
    .map((item: any) => item?.text ?? item?.input ?? item?.output ?? "")
    .filter(Boolean);
  return parts.join("\n\n");
}

function createSummary(path: string, size: number, firstMeta: any, counters: {
  messageCount: number;
  turnCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  reasoningCount: number;
  lastTimestamp: string;
}): SessionSummary {
  const payload = firstMeta?.payload ?? {};
  const title = payload?.thread_name || payload?.title || path.split("/").at(-1) || "";
  return {
    id: payload?.id ?? path,
    filePath: path,
    fileName: path.split("/").at(-1) ?? path,
    size,
    dateLabel: firstMeta?.timestamp ?? "",
    title,
    cwd: payload?.cwd ?? "",
    model: payload?.model ?? payload?.base_instructions?.model ?? "",
    messageCount: counters.messageCount,
    turnCount: counters.turnCount,
    userMessageCount: counters.userMessageCount,
    assistantMessageCount: counters.assistantMessageCount,
    toolCallCount: counters.toolCallCount,
    reasoningCount: counters.reasoningCount,
    lastTimestamp: counters.lastTimestamp
  };
}

function normalizeEntry(
  raw: any,
  lineNumber: number,
  turnId: string,
  carryCallMap: Map<string, TimelineEntry>
): TimelineEntry | null {
  const timestamp = raw?.timestamp ?? "";
  const type = raw?.type ?? "unknown";

  if (type === "response_item") {
    const payload = raw.payload ?? {};
    if (payload.type === "message") {
      const content = summarizeMessageContent(payload);
      const role = payload.role ?? "unknown";
      const kind =
        role === "user"
          ? "user_message"
          : role === "assistant"
            ? "assistant_message"
            : "system_message";
      return {
        id: `${turnId}-${lineNumber}-${payload.type}-${role}`,
        turnId,
        timestamp,
        kind,
        role,
        title: role === "user" ? "用户消息" : role === "assistant" ? "助手消息" : `${role} 消息`,
        summary: clampText(content, 120) || "空消息",
        collapsedByDefault: role !== "user" && role !== "assistant",
        preview: clampText(content, 220),
        details: content,
        rawType: payload.type,
        lineNumber
      };
    }

    if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      const details = payload.arguments ?? payload.input ?? "";
      const entry: TimelineEntry = {
        id: `${turnId}-${lineNumber}-${payload.call_id ?? payload.name}`,
        turnId,
        timestamp,
        kind: "tool_call_group",
        title: `工具调用 · ${payload.name ?? "unknown"}`,
        summary: clampText(details, 120) || "无参数",
        collapsedByDefault: true,
        preview: clampText(details, 220),
        details: typeof details === "string" ? details : JSON.stringify(details, null, 2),
        rawType: payload.type,
        callId: payload.call_id,
        toolName: payload.name,
        lineNumber
      };
      if (payload.call_id) {
        carryCallMap.set(payload.call_id, entry);
      }
      return entry;
    }

    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const details = payload.output ?? "";
      const sourceCall = payload.call_id ? carryCallMap.get(payload.call_id) : null;
      return {
        id: `${turnId}-${lineNumber}-output-${payload.call_id ?? "unknown"}`,
        turnId,
        timestamp,
        kind: "tool_output_group",
        title: `工具输出 · ${sourceCall?.toolName ?? payload.call_id ?? "unknown"}`,
        summary: clampText(details, 120) || "无输出",
        collapsedByDefault: true,
        preview: clampText(details, 220),
        details: typeof details === "string" ? details : JSON.stringify(details, null, 2),
        rawType: payload.type,
        callId: payload.call_id,
        toolName: sourceCall?.toolName,
        lineNumber
      };
    }

    if (payload.type === "reasoning") {
      const details = payload.content
        ? JSON.stringify(payload.content, null, 2)
        : payload.encrypted_content
          ? "该 reasoning 内容已加密，仅展示占位。"
          : "无 reasoning 内容";
      return {
        id: `${turnId}-${lineNumber}-reasoning`,
        turnId,
        timestamp,
        kind: "reasoning_group",
        title: "Reasoning",
        summary: payload.encrypted_content ? "已加密的 reasoning 内容" : clampText(details, 120),
        collapsedByDefault: true,
        preview: clampText(details, 220),
        details,
        rawType: payload.type,
        lineNumber
      };
    }
  }

  if (type === "turn_context") {
    return {
      id: `${turnId}-${lineNumber}-turn-context`,
      turnId,
      timestamp,
      kind: "meta",
      title: "Turn Context",
      summary: clampText(JSON.stringify(raw.payload ?? {}), 120),
      collapsedByDefault: true,
      preview: clampText(JSON.stringify(raw.payload ?? {}), 220),
      details: JSON.stringify(raw.payload ?? {}, null, 2),
      rawType: type,
      lineNumber
    };
  }

  if (type === "event_msg" || type === "compacted" || type === "session_meta") {
    return {
      id: `${turnId}-${lineNumber}-${type}`,
      turnId,
      timestamp,
      kind: type === "event_msg" ? "event" : "meta",
      title: type,
      summary: clampText(JSON.stringify(raw.payload ?? {}), 120),
      collapsedByDefault: true,
      preview: clampText(JSON.stringify(raw.payload ?? {}), 220),
      details: JSON.stringify(raw.payload ?? {}, null, 2),
      rawType: type,
      lineNumber
    };
  }

  return null;
}

async function buildSessionSummary(
  path: string,
  handle: FileSystemFileHandle
): Promise<SessionSummary> {
  const file = await handle.getFile();
  let firstMeta: any = null;
  let threadTitle = "";
  let firstModel = "";
  const counters = {
    messageCount: 0,
    turnCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolCallCount: 0,
    reasoningCount: 0,
    lastTimestamp: ""
  };

  await forEachJsonLine(file, (line) => {
    const raw = parseJsonLine(line);
    if (!raw) {
      return;
    }
    counters.lastTimestamp = raw.timestamp ?? counters.lastTimestamp;
    if (!firstMeta && raw.type === "session_meta") {
      firstMeta = raw;
    }
    if (!threadTitle && raw.type === "event_msg" && raw.payload?.type === "thread_name_updated") {
      threadTitle = raw.payload.thread_name ?? "";
    }
    if (!firstModel && raw.type === "turn_context" && raw.payload?.model) {
      firstModel = raw.payload.model;
    }
    if (raw.type === "turn_context") {
      counters.turnCount += 1;
      return;
    }
    if (raw.type !== "response_item") {
      return;
    }
    const payload = raw.payload ?? {};
    if (payload.type === "message") {
      counters.messageCount += 1;
      if (payload.role === "user") {
        counters.userMessageCount += 1;
      }
      if (payload.role === "assistant") {
        counters.assistantMessageCount += 1;
      }
      return;
    }
    if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      counters.toolCallCount += 1;
      return;
    }
    if (payload.type === "reasoning") {
      counters.reasoningCount += 1;
    }
  });

  const summary = createSummary(path, file.size, firstMeta, counters);
  return {
    ...summary,
    title: threadTitle || summary.title,
    model: firstModel || summary.model
  };
}

async function buildSessionDetails(
  summary: SessionSummary,
  sessionsRoot: FileSystemDirectoryHandle
): Promise<SessionDetails> {
  const pathParts = summary.filePath.split("/");
  let cursor: FileSystemDirectoryHandle = sessionsRoot;
  for (const part of pathParts.slice(0, -1)) {
    cursor = await cursor.getDirectoryHandle(part);
  }
  const fileHandle = await cursor.getFileHandle(pathParts.at(-1)!);
  const file = await fileHandle.getFile();

  const turns = new Map<string, TurnGroup>();
  const carryCallMap = new Map<string, TimelineEntry>();
  let currentTurnId = "prelude";

  await forEachJsonLine(file, (line, index) => {
    const raw = parseJsonLine(line);
    if (!raw) {
      return;
    }
    if (raw.type === "turn_context" && raw.payload?.turn_id) {
      currentTurnId = raw.payload.turn_id;
      if (!turns.has(currentTurnId)) {
        turns.set(currentTurnId, {
          id: currentTurnId,
          label: `轮次 ${turns.size + 1}`,
          startedAt: raw.timestamp ?? "",
          entries: []
        });
      }
    }

    if (!turns.has(currentTurnId)) {
      turns.set(currentTurnId, {
        id: currentTurnId,
        label: currentTurnId === "prelude" ? "会话前置信息" : `轮次 ${turns.size + 1}`,
        startedAt: raw.timestamp ?? "",
        entries: []
      });
    }

    const entry = normalizeEntry(raw, index + 1, currentTurnId, carryCallMap);
    if (!entry) {
      return;
    }
    turns.get(currentTurnId)!.entries.push(entry);
  });

  const orderedTurns = Array.from(turns.values()).sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt)
  );

  return {
    summary,
    turns: orderedTurns,
    totalEntries: orderedTurns.reduce((acc, turn) => acc + turn.entries.length, 0)
  };
}

self.onmessage = async (event: MessageEvent<WorkerIndexMessage>) => {
  try {
    if (event.data.type === "indexDirectory") {
      const files = await collectJsonlFiles(event.data.sessionsRoot);
      const summaries: SessionSummary[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        postMessageToUi({
          type: "indexProgress",
          payload: {
            filesScanned: index,
            totalFiles: files.length,
            currentFile: file.path
          }
        });
        summaries.push(await buildSessionSummary(file.path, file.handle));
      }
      summaries.sort((left, right) => right.lastTimestamp.localeCompare(left.lastTimestamp));
      postMessageToUi({
        type: "indexComplete",
        payload: summaries
      });
      return;
    }

    if (event.data.type === "loadSession") {
      const details = await buildSessionDetails(event.data.session, event.data.sessionsRoot);
      postMessageToUi({
        type: "sessionLoaded",
        payload: details
      });
    }
  } catch (error) {
    postMessageToUi({
      type: "workerError",
      payload: error instanceof Error ? error.message : "未知 Worker 错误"
    });
  }
};
