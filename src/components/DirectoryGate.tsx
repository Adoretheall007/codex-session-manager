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
        <h1>当前浏览器不支持本地目录授权</h1>
        <p>
          这个页面可以直接部署在 Netlify，但会话数据仍然读取你本机目录。首版依赖 Chromium 的
          File System Access API，请使用桌面版 Chrome、Edge 或其他兼容浏览器打开。
        </p>
        <div className="helper-list">
          <p>GitHub 仓库可直接连接 Netlify 自动构建，无需额外打包上传。</p>
          <p>部署站点只托管前端页面，不会把本地 `sessions` 内容上传到服务器。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <h1>Codex Session Manager</h1>
      <p>
        这个站点可以由 GitHub 仓库自动部署到 Netlify，但读取的仍然是你当前电脑上的 `sessions`
        目录。首次使用需要手动授权目录访问，之后浏览器会尝试恢复上次目录句柄。
      </p>
      <div className="helper-list">
        <p>推荐环境：桌面版 Chrome / Edge / 其他 Chromium 浏览器。</p>
        <p>Netlify 提供 HTTPS，满足 File System Access API 的安全上下文要求。</p>
        <p>若浏览器隐私策略变化、站点域名变化或权限被撤销，恢复上次目录时可能需要重新授权。</p>
      </div>
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
