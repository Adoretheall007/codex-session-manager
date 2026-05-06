type DirectoryGateProps = {
  supported: boolean;
  busy: boolean;
  hasRestorableHandle: boolean;
  error: string | null;
  onPickDirectory: () => void;
  onRestoreDirectory: () => void;
};

export function DirectoryGate(props: DirectoryGateProps) {
  if (!props.supported) {
    return (
      <div className="empty-state">
        <h1>当前浏览器不支持目录直连</h1>
        <p>
          首版依赖 Chromium 的 File System Access API。请使用 Chrome、Edge
          或其他兼容浏览器打开。
        </p>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <h1>Codex Session Manager</h1>
      <p>
        选择本地 `sessions` 根目录，工具会在浏览器内流式建立会话索引，并按轮次展示正文、工具调用、工具输出和辅助事件。
      </p>
      <div className="actions">
        <button className="primary-button" disabled={props.busy} onClick={props.onPickDirectory}>
          选择 Session 目录
        </button>
        {props.hasRestorableHandle ? (
          <button className="secondary-button" disabled={props.busy} onClick={props.onRestoreDirectory}>
            恢复上次目录
          </button>
        ) : null}
      </div>
      {props.error ? <p className="error-text">{props.error}</p> : null}
    </div>
  );
}
