type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  readonly kind: "file" | "directory";
  readonly name: string;
  queryPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState>;
  requestPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}
