import { useEffect, useMemo, useRef, useState } from "react";
import { DirectoryGate } from "./components/DirectoryGate";
import { SessionList } from "./components/SessionList";
import { TimelineView } from "./components/TimelineView";
import { filterSessions } from "./lib/filter";
import {
  chooseDirectoryHandle,
  isFileSystemAccessSupported,
  loadDirectoryHandle,
  saveDirectoryHandle,
  verifyDirectoryPermission
} from "./lib/file-system";
import type {
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
    const allowed = await verifyDirectoryPermission(handle);
    if (!allowed) {
      setError("目录读取权限未授予。");
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
        setError("当前浏览器不支持目录选择。");
        return;
      }
      await startIndexing(handle);
    } catch (pickerError) {
      if (pickerError instanceof DOMException && pickerError.name === "AbortError") {
        return;
      }
      setError(pickerError instanceof Error ? pickerError.message : "选择目录失败");
    }
  }

  async function handleRestoreDirectory() {
    if (!restorableHandle) {
      return;
    }
    await startIndexing(restorableHandle);
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
