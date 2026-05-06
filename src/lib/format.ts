export function formatFileSize(size: number): string {
  const mb = size / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function clampText(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, length - 1))}…`;
}

export function formatDateLabel(iso: string): string {
  if (!iso) {
    return "未知时间";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
