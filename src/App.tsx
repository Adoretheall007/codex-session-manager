import { useEffect, useMemo, useRef, useState } from "react";
import { DirectoryGate } from "./components/DirectoryGate";
import { SessionList } from "./components/SessionList";
import { TimelineView } from "./components/TimelineView";
import { filterSessions } from "./lib/filter";
import {
  chooseDirectoryHandle,
  getDirectoryPermissionState,
  isFileSystemAccessSupported,
  loadDirectoryHandle,
  saveDirectoryHandle,
  verifyDirectoryPermission
} from "./lib/file-system";
import type {
  DirectoryAccessErrorReason,
  IndexProgress,
  SessionDetails,
  SessionFilterState,
  SessionSummary,
  WorkerResponseMessage
} from "./types";

const initialFilters: SessionFilterState = {
  query: "",
  cwdQuery: "",
  onlyLargeFiles: false
};

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

export function App() {
  const workerRef = useRef<Worker | null>(null);
  const [supported] = useState(isFileSystemAccessSupported());
  const [restorableHandle, setRestorableHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<SessionDetails | null>(null);
  const [filters, setFilters] = useState<SessionFilterState>(initialFilters);
  const [busy, setBusy] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./session-worker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;
      if (message.type === "indexProgress") {
        setProgress(message.payload);
        return;
      }
      if (message.type === "indexComplete") {
        setSessions(message.payload);
        setBusy(false);
        setProgress(null);
        if (message.payload.length > 0) {
          setSelectedSession(message.payload[0]);
        }
        return;
      }
      if (message.type === "sessionLoaded") {
        setSelectedDetails(message.payload);
        setLoadingSession(false);
        return;
      }
      if (message.type === "workerError") {
        setError(message.payload);
        setBusy(false);
        setLoadingSession(false);
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
  }, [supported]);

  useEffect(() => {
    if (!selectedSession || !rootHandle || !workerRef.current) {
      return;
    }
    setLoadingSession(true);
    setError(null);
    workerRef.current.postMessage({
      type: "loadSession",
      session: selectedSession,
      sessionsRoot: rootHandle
    });
  }, [selectedSession, rootHandle]);

  const visibleSessions = useMemo(
    () => filterSessions(sessions, filters),
    [filters, sessions]
  );

  async function startIndexing(handle: FileSystemDirectoryHandle) {
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
    setError(null);
    setProgress({
      filesScanned: 0,
      totalFiles: 0,
      currentFile: ""
    });
    await saveDirectoryHandle(handle);
    workerRef.current?.postMessage({
      type: "indexDirectory",
      sessionsRoot: handle
    });
  }

  async function handlePickDirectory() {
    try {
      const handle = await chooseDirectoryHandle();
      if (!handle) {
        setError(formatDirectoryError("unsupported_browser"));
        return;
      }
      await startIndexing(handle);
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
      await startIndexing(restorableHandle);
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
    <div className="app-shell">
      <SessionList
        filters={filters}
        selectedId={selectedSession?.id ?? null}
        sessions={visibleSessions}
        onFilterChange={setFilters}
        onSelect={setSelectedSession}
      />
      <section className="workspace">
        <div className="top-bar">
          <div>
            <strong>目录已连接</strong>
            <span className="top-bar-detail">
              {busy && progress
                ? ` 正在扫描 ${progress.filesScanned}/${progress.totalFiles} · ${progress.currentFile}`
                : " 已完成索引"}
            </span>
          </div>
          <button className="secondary-button" onClick={handlePickDirectory}>
            切换目录
          </button>
        </div>
        <TimelineView details={selectedDetails} error={error} loading={loadingSession} />
      </section>
    </div>
  );
}
