import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DirectoryGate } from "./components/DirectoryGate";
import { MemoSessionList } from "./components/SessionList";
import { TimelineView } from "./components/TimelineView";
import { filterSessions } from "./lib/filter";
import {
  chooseDirectoryHandle,
  getDirectoryPermissionState,
  isFileSystemAccessSupported,
  loadDirectoryAbsolutePath,
  loadDirectoryHandle,
  saveDirectoryAbsolutePath,
  saveDirectoryHandle,
  verifyDirectoryPermission
} from "./lib/file-system";
import type {
  DirectoryAccessErrorReason,
  IndexProgress,
  SessionDetails,
  SessionDetailsUpdate,
  SessionFilterState,
  SessionSummary,
  SessionTurnPatch,
  WorkerResponseMessage
} from "./types";

const initialFilters: SessionFilterState = {
  query: "",
  onlyLargeFiles: false,
  hideFoldedContent: false,
  sortBy: "recent_activity"
};

const SIDEBAR_WIDTH_STORAGE_KEY = "codex-session-manager.sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 330;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 520;

function getSidebarWidthMax(viewportWidth: number) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - 420));
}

function clampSidebarWidth(width: number, viewportWidth: number) {
  const maxWidth = getSidebarWidthMax(viewportWidth);
  return Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function loadStoredSidebarWidth() {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  const rawWidth = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const parsedWidth = Number(rawWidth);

  if (!Number.isFinite(parsedWidth)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return clampSidebarWidth(parsedWidth, window.innerWidth);
}

function formatDirectoryError(reason: DirectoryAccessErrorReason, fallback?: string) {
  switch (reason) {
    case "unsupported_browser":
      return "当前浏览器不支持目录授权。部署在 Netlify 后仍需使用桌面版 Chrome 或 Edge。";
    case "permission_denied":
      return "目录读取权限未授予。请在浏览器弹窗中允许访问，或重新点击“选择 Session 目录”。";
    case "directory_handle_revoked":
      return "上次保存的目录句柄已失效，可能是浏览器权限、隐私模式、站点域名或目录内容变化导致。请重新授权目录。";
    case "parse_failed":
      return "会话文件读取失败，可能是文件内容损坏或 JSONL 格式不完整。";
    case "file_too_large":
      return "检测到过大的会话文件，当前浏览器内解析失败。请先缩小样本范围后重试。";
    case "unknown":
    default:
      return fallback ?? "读取目录失败，请重试。";
  }
}

function applySessionTurnPatches(current: SessionDetails, turnPatches: SessionTurnPatch[]): SessionDetails {
  if (turnPatches.length === 0) {
    return current;
  }

  const nextTurns = current.turns.map((turn) => ({
    ...turn,
    entries: [...turn.entries]
  }));
  const turnIndexMap = new Map(nextTurns.map((turn, index) => [turn.id, index]));

  for (const patch of turnPatches) {
    const turnIndex = turnIndexMap.get(patch.id);

    if (turnIndex == null) {
      nextTurns.push({
        id: patch.id,
        label: patch.label,
        startedAt: patch.startedAt,
        entries: [...patch.entries]
      });
      turnIndexMap.set(patch.id, nextTurns.length - 1);
      continue;
    }

    const currentTurn = nextTurns[turnIndex];
    currentTurn.entries.push(...patch.entries);
  }

  nextTurns.sort((left, right) => left.startedAt.localeCompare(right.startedAt));

  return {
    ...current,
    turns: nextTurns
  };
}

function mergeDetailsUpdate(
  current: SessionDetails | null,
  summary: SessionSummary,
  detailsUpdate?: SessionDetailsUpdate
): SessionDetails | null {
  if (!detailsUpdate) {
    return current ? { ...current, summary } : current;
  }

  if (detailsUpdate.mode === "replace") {
    return detailsUpdate.details;
  }

  if (!current) {
    return current;
  }

  const merged = applySessionTurnPatches(current, detailsUpdate.patch.turnPatches);

  return {
    ...merged,
    summary,
    totalEntries: detailsUpdate.patch.totalEntries,
    parseState: detailsUpdate.patch.parseState
  };
}

export function App() {
  const workerRef = useRef<Worker | null>(null);
  const selectionPinnedRef = useRef(false);
  const activeIndexRequestIdRef = useRef(0);
  const activeLoadRequestIdRef = useRef(0);
  const activeRefreshRequestIdRef = useRef(0);
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [supported] = useState(isFileSystemAccessSupported());
  const [restorableHandle, setRestorableHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<SessionDetails | null>(null);
  const [filters, setFilters] = useState<SessionFilterState>(initialFilters);
  const [busy, setBusy] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(loadStoredSidebarWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [refreshingSessionId, setRefreshingSessionId] = useState<string | null>(null);
  const sidebarScale = useMemo(
    () => Number((sidebarWidth / DEFAULT_SIDEBAR_WIDTH).toFixed(3)),
    [sidebarWidth]
  );

  useEffect(() => {
    const worker = new Worker(new URL("./session-worker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;
      if (message.type === "indexProgress") {
        if (message.requestId !== activeIndexRequestIdRef.current) {
          return;
        }
        setProgress(message.payload);
        return;
      }
      if (message.type === "indexComplete") {
        if (message.requestId !== activeIndexRequestIdRef.current) {
          return;
        }
        setSessions(message.payload);
        setBusy(false);
        setProgress(null);
        if (message.payload.length > 0) {
          setSelectedSession((current) => {
            if (selectionPinnedRef.current && current) {
              const matched = message.payload.find((session) => session.id === current.id);
              if (matched) {
                return matched;
              }
            }
            return message.payload[0];
          });
        }
        return;
      }
      if (message.type === "sessionLoaded") {
        if (message.requestId !== activeLoadRequestIdRef.current) {
          return;
        }
        setSelectedDetails(message.payload);
        setLoadingSession(false);
        return;
      }
      if (message.type === "sessionRefreshed") {
        if (message.requestId !== activeRefreshRequestIdRef.current) {
          return;
        }
        setRefreshingSessionId(null);
        setSessions((currentSessions) => {
          const nextSessions = currentSessions.map((session) =>
            session.id === message.payload.summary.id ? message.payload.summary : session
          );
          nextSessions.sort((left, right) =>
            (right.lastTimestamp || right.dateLabel).localeCompare(left.lastTimestamp || left.dateLabel)
          );
          return nextSessions;
        });
        setSelectedSession((current) =>
          current?.id === message.payload.summary.id ? message.payload.summary : current
        );
        setSelectedDetails((current) =>
          current?.summary.id === message.payload.summary.id
            ? mergeDetailsUpdate(current, message.payload.summary, message.payload.detailsUpdate)
            : current
        );
        setLoadingSession(false);
        return;
      }
      if (message.type === "workerError") {
        if (
          message.requestId !== activeIndexRequestIdRef.current &&
          message.requestId !== activeLoadRequestIdRef.current &&
          message.requestId !== activeRefreshRequestIdRef.current
        ) {
          return;
        }
        setError(message.payload);
        setBusy(false);
        setLoadingSession(false);
        setRefreshingSessionId(null);
      }
    };

    return () => {
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    if (!supported) {
      return;
    }
    loadDirectoryHandle()
      .then((handle) => {
        setRestorableHandle(handle);
      })
      .catch(() => {
        setRestorableHandle(null);
      });
    loadDirectoryAbsolutePath()
      .then((path) => {
        setRootPath(path);
      })
      .catch(() => {
        setRootPath("");
      });
  }, [supported]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleWindowResize = () => {
      setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth, window.innerWidth));
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (!isSidebarResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const nextWidth = resizeState.startWidth + event.clientX - resizeState.startX;
      setSidebarWidth(clampSidebarWidth(nextWidth, window.innerWidth));
    };

    const stopSidebarResize = () => {
      sidebarResizeStateRef.current = null;
      setIsSidebarResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopSidebarResize);
    window.addEventListener("pointercancel", stopSidebarResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopSidebarResize);
      window.removeEventListener("pointercancel", stopSidebarResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isSidebarResizing]);

  useEffect(() => {
    if (!selectedSession || !rootHandle || !workerRef.current) {
      return;
    }
    if (
      selectedDetails?.summary.id === selectedSession.id &&
      selectedDetails.summary.size === selectedSession.size &&
      selectedDetails.summary.fileLastModified === selectedSession.fileLastModified
    ) {
      return;
    }
    const requestId = activeLoadRequestIdRef.current + 1;
    activeLoadRequestIdRef.current = requestId;
    setLoadingSession(true);
    setError(null);
    workerRef.current.postMessage({
      type: "loadSession",
      requestId,
      session: selectedSession,
      sessionsRoot: rootHandle
    });
  }, [rootHandle, selectedDetails, selectedSession]);

  const visibleSessions = useMemo(
    () => filterSessions(sessions, filters),
    [filters, sessions]
  );

  async function startIndexing(handle: FileSystemDirectoryHandle, absolutePath?: string) {
    const permissionState = await getDirectoryPermissionState(handle);
    if (permissionState === "denied") {
      setError(formatDirectoryError("directory_handle_revoked"));
      return;
    }
    const allowed = await verifyDirectoryPermission(handle);
    if (!allowed) {
      setError(formatDirectoryError("permission_denied"));
      return;
    }
    setRootHandle(handle);
    setRestorableHandle(handle);
    setSessions([]);
    setSelectedDetails(null);
    setSelectedSession(null);
    setBusy(true);
    setLoadingSession(false);
    setError(null);
    setProgress({
      filesScanned: 0,
      totalFiles: 0,
      currentFile: ""
    });
    activeLoadRequestIdRef.current += 1;
    await saveDirectoryHandle(handle);
    if (absolutePath) {
      await saveDirectoryAbsolutePath(absolutePath);
      setRootPath(absolutePath);
    }
    const requestId = activeIndexRequestIdRef.current + 1;
    activeIndexRequestIdRef.current = requestId;
    workerRef.current?.postMessage({
      type: "indexDirectory",
      requestId,
      sessionsRoot: handle
    });
  }

  const handleRefresh = useCallback(async () => {
    if (!rootHandle || busy) {
      return;
    }

    selectionPinnedRef.current = Boolean(selectedSession);
    await startIndexing(rootHandle, rootPath);
  }, [busy, rootHandle, rootPath, selectedSession]);

  const handleSelectSession = useCallback((session: SessionSummary) => {
    selectionPinnedRef.current = true;
    setSelectedSession(session);
  }, []);

  const handleRefreshSession = useCallback(
    async (session: SessionSummary) => {
      if (!rootHandle || !workerRef.current) {
        return;
      }

      const permissionState = await getDirectoryPermissionState(rootHandle);
      if (permissionState === "denied") {
        setError(formatDirectoryError("directory_handle_revoked"));
        return;
      }

      const allowed = await verifyDirectoryPermission(rootHandle);
      if (!allowed) {
        setError(formatDirectoryError("permission_denied"));
        return;
      }

      const requestId = activeRefreshRequestIdRef.current + 1;
      activeRefreshRequestIdRef.current = requestId;
      const includeDetails = selectedSession?.id === session.id;

      setRefreshingSessionId(session.id);
      setError(null);
      if (includeDetails) {
        setLoadingSession(false);
      }

      workerRef.current.postMessage({
        type: "refreshSession",
        requestId,
        includeDetails,
        detailsState: includeDetails ? selectedDetails?.parseState : undefined,
        session,
        sessionsRoot: rootHandle
      });
    },
    [rootHandle, selectedDetails, selectedSession]
  );

  const handleFilterChange = useCallback((next: SessionFilterState) => {
    setFilters(next);
  }, []);

  const handleSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (window.innerWidth <= 1200) {
        return;
      }

      sidebarResizeStateRef.current = {
        startX: event.clientX,
        startWidth: sidebarWidth
      };
      setIsSidebarResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth]
  );

  async function handlePickDirectory() {
    try {
      const handle = await chooseDirectoryHandle();
      if (!handle) {
        setError(formatDirectoryError("unsupported_browser"));
        return;
      }
      const absolutePath = prompt(
        "请输入当前选择目录的绝对路径，用于界面展示。建议选择 .codex 根目录，例如：C:\\Users\\你的用户名\\.codex",
        rootPath || handle.name
      );
      await startIndexing(handle, absolutePath?.trim() || handle.name);
    } catch (pickerError) {
      if (pickerError instanceof DOMException && pickerError.name === "AbortError") {
        return;
      }
      setError(
        pickerError instanceof Error
          ? formatDirectoryError("unknown", pickerError.message)
          : formatDirectoryError("unknown", "选择目录失败")
      );
    }
  }

  async function handleRestoreDirectory() {
    if (!restorableHandle) {
      return;
    }
    try {
      await startIndexing(restorableHandle, rootPath);
    } catch (restoreError) {
      setError(
        restoreError instanceof DOMException && restoreError.name === "NotFoundError"
          ? formatDirectoryError("directory_handle_revoked")
          : restoreError instanceof Error
            ? formatDirectoryError("unknown", restoreError.message)
            : formatDirectoryError("directory_handle_revoked")
      );
    }
  }

  const shellStyle = useMemo(
    () =>
      ({
        "--sidebar-width": `${sidebarWidth}px`,
        "--sidebar-scale": String(sidebarScale)
      }) as CSSProperties,
    [sidebarScale, sidebarWidth]
  );

  if (!rootHandle) {
    return (
      <div className="app-shell gate-shell">
        <DirectoryGate
          busy={busy}
          error={error}
          hasRestorableHandle={Boolean(restorableHandle)}
          supported={supported}
          onPickDirectory={handlePickDirectory}
          onRestoreDirectory={handleRestoreDirectory}
        />
      </div>
    );
  }

  return (
    <div className={`app-shell${isSidebarResizing ? " is-resizing" : ""}`} style={shellStyle}>
      <MemoSessionList
        filters={filters}
        directoryPath={rootPath || rootHandle.name}
        directoryStatusText={
          busy && progress
            ? `正在扫描 ${progress.filesScanned}/${progress.totalFiles} · ${progress.currentFile}`
            : "已完成索引"
        }
        refreshingSessionId={refreshingSessionId}
        selectedId={selectedSession?.id ?? null}
        sessions={visibleSessions}
        onPickDirectory={handlePickDirectory}
        onRefresh={handleRefresh}
        onRefreshSession={handleRefreshSession}
        onFilterChange={handleFilterChange}
        onSelect={handleSelectSession}
      />
      <div
        aria-hidden="true"
        className="sidebar-resizer"
        onPointerDown={handleSidebarResizeStart}
        role="presentation"
      />
      <section className="workspace">
        <TimelineView
          details={selectedDetails}
          error={error}
          loading={loadingSession}
          hideFoldedContent={filters.hideFoldedContent}
        />
      </section>
    </div>
  );
}
