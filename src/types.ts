export type SessionSummary = {
  id: string;
  filePath: string;
  fileName: string;
  size: number;
  fileLastModified: number;
  dateLabel: string;
  title: string;
  resume: string;
  cwd: string;
  model: string;
  messageCount: number;
  turnCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  reasoningCount: number;
  lastTimestamp: string;
  searchText: string;
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

export type SessionParseState = {
  fileSize: number;
  fileLastModified: number;
  lineCount: number;
  totalEntries: number;
  lastTurnId: string;
  turns: Array<Pick<TurnGroup, "id" | "label" | "startedAt">>;
  toolCallNames: Record<string, string>;
};

export type SessionDetails = {
  summary: SessionSummary;
  turns: TurnGroup[];
  totalEntries: number;
  parseState: SessionParseState;
};

export type SessionTurnPatch = {
  id: string;
  label: string;
  startedAt: string;
  isNewTurn: boolean;
  entries: TimelineEntry[];
};

export type SessionDetailsUpdate =
  | {
      mode: "replace";
      details: SessionDetails;
    }
  | {
      mode: "append";
      patch: {
        totalEntries: number;
        parseState: SessionParseState;
        turnPatches: SessionTurnPatch[];
      };
    };

export type SessionFilterState = {
  query: string;
  onlyLargeFiles: boolean;
  hideFoldedContent: boolean;
  sortBy: "recent_activity";
};

export type IndexProgress = {
  filesScanned: number;
  totalFiles: number;
  currentFile: string;
};

export type WorkerIndexMessage =
  | {
      type: "indexDirectory";
      requestId: number;
      sessionsRoot: FileSystemDirectoryHandle;
    }
  | {
      type: "loadSession";
      requestId: number;
      session: SessionSummary;
      sessionsRoot: FileSystemDirectoryHandle;
    }
  | {
      type: "refreshSession";
      requestId: number;
      includeDetails: boolean;
      detailsState?: SessionParseState;
      session: SessionSummary;
      sessionsRoot: FileSystemDirectoryHandle;
    };

export type WorkerResponseMessage =
  | {
      type: "indexProgress";
      requestId: number;
      payload: IndexProgress;
    }
  | {
      type: "indexComplete";
      requestId: number;
      payload: SessionSummary[];
    }
  | {
      type: "sessionLoaded";
      requestId: number;
      payload: SessionDetails;
    }
  | {
      type: "sessionRefreshed";
      requestId: number;
      payload: {
        summary: SessionSummary;
        detailsUpdate?: SessionDetailsUpdate;
      };
    }
  | {
      type: "workerError";
      requestId: number;
      payload: string;
    };

export type DirectoryAccessErrorReason =
  | "unsupported_browser"
  | "permission_denied"
  | "directory_handle_revoked"
  | "parse_failed"
  | "file_too_large"
  | "unknown";
