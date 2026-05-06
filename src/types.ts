export type SessionSummary = {
  id: string;
  filePath: string;
  fileName: string;
  size: number;
  dateLabel: string;
  title: string;
  cwd: string;
  model: string;
  messageCount: number;
  turnCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  reasoningCount: number;
  lastTimestamp: string;
};

export type TimelineKind =
  | "user_message"
  | "assistant_message"
  | "system_message"
  | "tool_call_group"
  | "tool_output_group"
  | "reasoning_group"
  | "event"
  | "meta";

export type TimelineEntry = {
  id: string;
  turnId: string;
  timestamp: string;
  kind: TimelineKind;
  role?: string;
  title: string;
  summary: string;
  collapsedByDefault: boolean;
  preview: string;
  details: string;
  rawType: string;
  callId?: string;
  toolName?: string;
  lineNumber: number;
};

export type TurnGroup = {
  id: string;
  label: string;
  startedAt: string;
  entries: TimelineEntry[];
};

export type SessionDetails = {
  summary: SessionSummary;
  turns: TurnGroup[];
  totalEntries: number;
};

export type SessionFilterState = {
  query: string;
  cwdQuery: string;
  onlyLargeFiles: boolean;
};

export type IndexProgress = {
  filesScanned: number;
  totalFiles: number;
  currentFile: string;
};

export type WorkerIndexMessage =
  | {
      type: "indexDirectory";
      sessionsRoot: FileSystemDirectoryHandle;
    }
  | {
      type: "loadSession";
      session: SessionSummary;
      sessionsRoot: FileSystemDirectoryHandle;
    };

export type WorkerResponseMessage =
  | {
      type: "indexProgress";
      payload: IndexProgress;
    }
  | {
      type: "indexComplete";
      payload: SessionSummary[];
    }
  | {
      type: "sessionLoaded";
      payload: SessionDetails;
    }
  | {
      type: "workerError";
      payload: string;
    };
