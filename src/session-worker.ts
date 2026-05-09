import type {
  SessionDetailsUpdate,
  SessionParseState,
  SessionDetails,
  SessionSummary,
  SessionTurnPatch,
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
    if (name.startsWith("rollout-") && name.endsWith(".jsonl")) {
      files.push({ path: nextPath, handle });
    }
  }
  return files;
}

async function forEachJsonLine(
  file: Blob,
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

function extractGoalObjectiveText(text: string): string {
  if (!text.includes("The objective below is user-provided data")) {
    return "";
  }

  const match = text.match(/<untrusted_objective>\s*([\s\S]*?)\s*<\/untrusted_objective>/);
  return match?.[1]?.trim() ?? "";
}

type SessionIndexEntry = {
  threadName: string;
  updatedAt: string;
};

function getSummaryTitle(summary: {
  fileName: string;
  fallbackTitle: string;
  firstUserMessage: string;
  indexedTitle?: string;
  legacyTitle: string;
}): string {
  return (
    summary.indexedTitle ||
    summary.legacyTitle ||
    summary.fallbackTitle ||
    clampText(summary.firstUserMessage, 48) ||
    summary.fileName
  );
}

function getTitleCandidateFromPayload(payload: any): string {
  return (
    payload?.thread_name ??
    payload?.title ??
    payload?.new_name ??
    payload?.new_title ??
    payload?.name ??
    ""
  );
}

async function readSessionIndex(
  root: FileSystemDirectoryHandle
): Promise<Map<string, SessionIndexEntry>> {
  const titleBySessionId = new Map<string, SessionIndexEntry>();

  try {
    const indexHandle = await root.getFileHandle("session_index.jsonl");
    const indexFile = await indexHandle.getFile();

    await forEachJsonLine(indexFile, (line) => {
      const raw = parseJsonLine(line);
      const id = raw?.id;
      const threadName = raw?.thread_name;
      const updatedAt = raw?.updated_at ?? "";

      if (typeof id !== "string" || typeof threadName !== "string" || !threadName.trim()) {
        return;
      }

      const current = titleBySessionId.get(id);
      if (!current || updatedAt.localeCompare(current.updatedAt) >= 0) {
        titleBySessionId.set(id, {
          threadName: threadName.trim(),
          updatedAt
        });
      }
    });
  } catch {
    return titleBySessionId;
  }

  return titleBySessionId;
}

function createSummary(path: string, file: File, firstMeta: any, counters: {
  messageCount: number;
  turnCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  reasoningCount: number;
  lastTimestamp: string;
  firstUserMessage: string;
  indexedTitle?: string;
  legacyTitle: string;
}): SessionSummary {
  const payload = firstMeta?.payload ?? {};
  const fileName = path.split("/").at(-1) ?? path;
  const cwd = payload?.cwd ?? "";
  const model = payload?.model ?? payload?.base_instructions?.model ?? "";
  const id = payload?.id ?? path;
  const title = getSummaryTitle({
    fileName,
    fallbackTitle: payload?.thread_name || payload?.title || "",
    firstUserMessage: counters.firstUserMessage,
    indexedTitle: counters.indexedTitle,
    legacyTitle: counters.legacyTitle
  });

  return {
    id,
    filePath: path,
    fileName,
    size: file.size,
    fileLastModified: file.lastModified,
    dateLabel: firstMeta?.timestamp ?? "",
    title,
    resume: `codex resume ${id}`,
    cwd,
    model,
    messageCount: counters.messageCount,
    turnCount: counters.turnCount,
    userMessageCount: counters.userMessageCount,
    assistantMessageCount: counters.assistantMessageCount,
    toolCallCount: counters.toolCallCount,
    reasoningCount: counters.reasoningCount,
    lastTimestamp: counters.lastTimestamp,
    searchText: [fileName, title, cwd, model, id, `codex resume ${id}`].join(" ").toLowerCase()
  };
}

function normalizeEntry(
  raw: any,
  lineNumber: number,
  turnId: string,
  carryCallMap: Map<string, TimelineEntry>
): TimelineEntry[] {
  const timestamp = raw?.timestamp ?? "";
  const type = raw?.type ?? "unknown";

  if (type === "response_item") {
    const payload = raw.payload ?? {};
    if (payload.type === "message") {
      const content = summarizeMessageContent(payload);
      const role = payload.role ?? "unknown";
      const goalObjective = role === "developer" ? extractGoalObjectiveText(content) : "";

      if (goalObjective) {
        return [
          {
            id: `${turnId}-${lineNumber}-${payload.type}-goal-user`,
            turnId,
            timestamp,
            kind: "user_message",
            role: "user",
            title: "用户消息",
            summary: clampText(goalObjective, 120) || "空消息",
            collapsedByDefault: false,
            preview: clampText(goalObjective, 220),
            details: goalObjective,
            rawType: "developer_goal_objective",
            lineNumber
          },
          {
            id: `${turnId}-${lineNumber}-${payload.type}-goal-wrapper`,
            turnId,
            timestamp,
            kind: "meta",
            role,
            title: "/goal 包装信息",
            summary: clampText(content, 120) || "无摘要",
            collapsedByDefault: true,
            preview: clampText(content, 220),
            details: content,
            rawType: "developer_goal_wrapper",
            lineNumber
          }
        ];
      }

      const kind =
        role === "user"
          ? "user_message"
          : role === "assistant"
            ? "assistant_message"
            : "system_message";
      return [{
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
      }];
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
      return [entry];
    }

    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const details = payload.output ?? "";
      const sourceCall = payload.call_id ? carryCallMap.get(payload.call_id) : null;
      return [{
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
      }];
    }

    if (payload.type === "reasoning") {
      const details = payload.content
        ? JSON.stringify(payload.content, null, 2)
        : payload.encrypted_content
          ? "该 reasoning 内容已加密，仅展示占位。"
          : "无 reasoning 内容";
      return [{
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
      }];
    }
  }

  if (type === "turn_context") {
    return [{
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
    }];
  }

  if (type === "event_msg" || type === "compacted" || type === "session_meta") {
    return [{
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
    }];
  }

  return [];
}

async function buildSessionSummary(
  path: string,
  handle: FileSystemFileHandle,
  titleBySessionId = new Map<string, SessionIndexEntry>()
): Promise<SessionSummary> {
  const file = await handle.getFile();
  let firstMeta: any = null;
  let firstModel = "";
  const counters = {
    messageCount: 0,
    turnCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolCallCount: 0,
    reasoningCount: 0,
    lastTimestamp: "",
    firstUserMessage: "",
    indexedTitle: "",
    legacyTitle: ""
  };

  await forEachJsonLine(file, (line) => {
    const raw = parseJsonLine(line);
    if (!raw) {
      return;
    }
    counters.lastTimestamp = raw.timestamp ?? counters.lastTimestamp;
    if (!firstMeta && raw.type === "session_meta") {
      firstMeta = raw;
      const indexedTitle = titleBySessionId.get(raw.payload?.id)?.threadName;
      if (indexedTitle) {
        counters.indexedTitle = indexedTitle;
      }
    }
    if (
      raw.type === "event_msg" &&
      (raw.payload?.type === "thread_name_updated" ||
        raw.payload?.type === "conversation_renamed" ||
        raw.payload?.type === "conversation_title_updated" ||
        raw.payload?.type === "forked_conversation_renamed")
    ) {
      counters.legacyTitle = getTitleCandidateFromPayload(raw.payload) || counters.legacyTitle;
    }
    if (raw.type === "event_msg" && raw.payload?.type === "user_message" && !counters.firstUserMessage) {
      counters.firstUserMessage = raw.payload.message ?? "";
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
      const content = summarizeMessageContent(payload);
      const goalObjective =
        payload.role === "developer" ? extractGoalObjectiveText(content) : "";
      counters.messageCount += 1;
      if (payload.role === "user" || goalObjective) {
        counters.userMessageCount += 1;
        if (!counters.firstUserMessage) {
          counters.firstUserMessage = goalObjective || content;
        }
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

  const summary = createSummary(path, file, firstMeta, counters);
  return {
    ...summary,
    model: firstModel || summary.model
  };
}

function createParseState(turns: TurnGroup[], summary: SessionSummary): SessionParseState {
  const toolCallNames: Record<string, string> = {};

  for (const turn of turns) {
    for (const entry of turn.entries) {
      if (entry.callId && entry.toolName) {
        toolCallNames[entry.callId] = entry.toolName;
      }
    }
  }

  return {
    fileSize: summary.size,
    fileLastModified: summary.fileLastModified,
    lineCount: turns.reduce((count, turn) => count + turn.entries.length, 0),
    totalEntries: turns.reduce((count, turn) => count + turn.entries.length, 0),
    lastTurnId: turns.at(-1)?.id ?? "prelude",
    turns: turns.map((turn) => ({
      id: turn.id,
      label: turn.label,
      startedAt: turn.startedAt
    })),
    toolCallNames
  };
}

function createTurnPatch(
  parseState: SessionParseState,
  turnsById: Map<string, TurnGroup>
): SessionTurnPatch[] {
  return Array.from(turnsById.values()).map((turn) => ({
    id: turn.id,
    label: turn.label,
    startedAt: turn.startedAt,
    isNewTurn: !parseState.turns.some((item) => item.id === turn.id),
    entries: turn.entries
  }));
}

async function resolveSessionFile(
  session: SessionSummary,
  sessionsRoot: FileSystemDirectoryHandle
) {
  const pathParts = session.filePath.split("/");
  let cursor: FileSystemDirectoryHandle = sessionsRoot;
  for (const part of pathParts.slice(0, -1)) {
    cursor = await cursor.getDirectoryHandle(part);
  }
  const fileHandle = await cursor.getFileHandle(pathParts.at(-1)!);
  const file = await fileHandle.getFile();

  return {
    fileHandle,
    file
  };
}

async function buildSessionDetails(
  summary: SessionSummary,
  sessionsRoot: FileSystemDirectoryHandle
): Promise<SessionDetails> {
  const { file } = await resolveSessionFile(summary, sessionsRoot);

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

    const entries = normalizeEntry(raw, index + 1, currentTurnId, carryCallMap);
    if (entries.length === 0) {
      return;
    }
    turns.get(currentTurnId)!.entries.push(...entries);
  });

  const orderedTurns = Array.from(turns.values()).sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt)
  );

  return {
    summary,
    turns: orderedTurns,
    totalEntries: orderedTurns.reduce((acc, turn) => acc + turn.entries.length, 0),
    parseState: createParseState(orderedTurns, summary)
  };
}

async function refreshSession(
  session: SessionSummary,
  sessionsRoot: FileSystemDirectoryHandle,
  includeDetails: boolean,
  detailsState?: SessionParseState
) {
  const { fileHandle, file } = await resolveSessionFile(session, sessionsRoot);
  const titleBySessionId = await readSessionIndex(sessionsRoot);
  const summary = await buildSessionSummary(session.filePath, fileHandle, titleBySessionId);
  let detailsUpdate: SessionDetailsUpdate | undefined;

  if (includeDetails) {
    const canAppend =
      detailsState &&
      file.size >= detailsState.fileSize &&
      file.lastModified >= detailsState.fileLastModified;

    if (canAppend) {
      const appendedBlob = file.slice(detailsState.fileSize);
      const turnsById = new Map<string, TurnGroup>();
      const carryCallMap = new Map<string, TimelineEntry>(
        Object.entries(detailsState.toolCallNames).map(([callId, toolName]) => [
          callId,
          {
            id: `carry-${callId}`,
            turnId: detailsState.lastTurnId,
            timestamp: "",
            kind: "tool_call_group",
            title: toolName,
            summary: "",
            collapsedByDefault: true,
            preview: "",
            details: "",
            rawType: "carry",
            callId,
            toolName,
            lineNumber: 0
          }
        ])
      );
      let currentTurnId = detailsState.lastTurnId || "prelude";
      let appendedLineCount = 0;

      await forEachJsonLine(appendedBlob, (line, index) => {
        const raw = parseJsonLine(line);
        if (!raw) {
          return;
        }
        appendedLineCount = index;
        if (raw.type === "turn_context" && raw.payload?.turn_id) {
          currentTurnId = raw.payload.turn_id;
          if (!turnsById.has(currentTurnId)) {
            const existingTurn = detailsState.turns.find((turn) => turn.id === currentTurnId);
            turnsById.set(currentTurnId, {
              id: currentTurnId,
              label: existingTurn?.label ?? `轮次 ${detailsState.turns.length + turnsById.size + 1}`,
              startedAt: existingTurn?.startedAt ?? raw.timestamp ?? "",
              entries: []
            });
          }
        }

        if (!turnsById.has(currentTurnId)) {
          const existingTurn = detailsState.turns.find((turn) => turn.id === currentTurnId);
          turnsById.set(currentTurnId, {
            id: currentTurnId,
            label:
              existingTurn?.label ??
              (currentTurnId === "prelude"
                ? "会话前置信息"
                : `轮次 ${detailsState.turns.length + turnsById.size + 1}`),
            startedAt: existingTurn?.startedAt ?? raw.timestamp ?? "",
            entries: []
          });
        }

        const entries = normalizeEntry(
          raw,
          detailsState.lineCount + index + 1,
          currentTurnId,
          carryCallMap
        );
        if (entries.length === 0) {
          return;
        }
        turnsById.get(currentTurnId)!.entries.push(...entries);
      });

      const turnPatches = createTurnPatch(detailsState, turnsById).filter(
        (turn) => turn.entries.length > 0
      );

      if (turnPatches.length > 0 || appendedLineCount > 0) {
        const nextParseState: SessionParseState = {
          fileSize: file.size,
          fileLastModified: file.lastModified,
          lineCount: detailsState.lineCount + appendedLineCount,
          totalEntries:
            detailsState.totalEntries +
            turnPatches.reduce((count, turn) => count + turn.entries.length, 0),
          lastTurnId: currentTurnId,
          turns: [
            ...detailsState.turns,
            ...turnPatches
              .filter((turn) => turn.isNewTurn)
              .map((turn) => ({
                id: turn.id,
                label: turn.label,
                startedAt: turn.startedAt
              }))
          ],
          toolCallNames: {
            ...detailsState.toolCallNames,
            ...Object.fromEntries(
              turnPatches
                .flatMap((turn) => turn.entries)
                .filter((entry) => entry.callId && entry.toolName)
                .map((entry) => [entry.callId!, entry.toolName!])
            )
          }
        };

        detailsUpdate = {
          mode: "append",
          patch: {
            totalEntries: nextParseState.totalEntries,
            parseState: nextParseState,
            turnPatches
          }
        };
      } else {
        detailsUpdate = {
          mode: "append",
          patch: {
            totalEntries: detailsState.totalEntries,
            parseState: {
              ...detailsState,
              fileSize: file.size,
              fileLastModified: file.lastModified
            },
            turnPatches: []
          }
        };
      }
    } else {
      const details = await buildSessionDetails(summary, sessionsRoot);
      detailsUpdate = {
        mode: "replace",
        details
      };
    }
  }

  return {
    summary,
    detailsUpdate
  };
}

self.onmessage = async (event: MessageEvent<WorkerIndexMessage>) => {
  const requestId = event.data.requestId;
  try {
    if (event.data.type === "indexDirectory") {
      const titleBySessionId = await readSessionIndex(event.data.sessionsRoot);
      const files = await collectJsonlFiles(event.data.sessionsRoot);
      const summaries: SessionSummary[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        postMessageToUi({
          type: "indexProgress",
          requestId,
          payload: {
            filesScanned: index,
            totalFiles: files.length,
            currentFile: file.path
          }
        });
        summaries.push(await buildSessionSummary(file.path, file.handle, titleBySessionId));
      }
      summaries.sort((left, right) => right.lastTimestamp.localeCompare(left.lastTimestamp));
      postMessageToUi({
        type: "indexComplete",
        requestId,
        payload: summaries
      });
      return;
    }

    if (event.data.type === "loadSession") {
      const details = await buildSessionDetails(event.data.session, event.data.sessionsRoot);
      postMessageToUi({
        type: "sessionLoaded",
        requestId,
        payload: details
      });
      return;
    }

    if (event.data.type === "refreshSession") {
      const payload = await refreshSession(
        event.data.session,
        event.data.sessionsRoot,
        event.data.includeDetails,
        event.data.detailsState
      );
      postMessageToUi({
        type: "sessionRefreshed",
        requestId,
        payload
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 Worker 错误";
    const normalizedMessage = message.includes("JSON")
        ? "会话文件解析失败，请检查 JSONL 内容是否完整。"
        : message;
    postMessageToUi({
      type: "workerError",
      requestId,
      payload: normalizedMessage
    });
  }
};
