const DB_NAME = "codex-session-manager";
const STORE_NAME = "directory-handles";
const HANDLE_KEY = "last-sessions-root";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function verifyDirectoryPermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const mode: FileSystemHandlePermissionDescriptor = { mode: "read" };
  if (!handle.queryPermission || !handle.requestPermission) {
    return true;
  }
  if ((await handle.queryPermission(mode)) === "granted") {
    return true;
  }
  return (await handle.requestPermission(mode)) === "granted";
}

export async function chooseDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!("showDirectoryPicker" in window)) {
    return null;
  }
  const picker = window.showDirectoryPicker as () => Promise<FileSystemDirectoryHandle>;
  return picker();
}

export function isFileSystemAccessSupported(): boolean {
  return "showDirectoryPicker" in window && "indexedDB" in window;
}
