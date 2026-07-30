import type {
  DepartmentFileViewAccess,
  FileItem,
} from '../api/content';

export type FileActionKind = 'favorite' | 'download';

export type FileActionAccessDecision =
  | {
    outcome: 'proceed';
    access: DepartmentFileViewAccess | null;
  }
  | {
    outcome: 'show_access_gate';
    access: DepartmentFileViewAccess;
  }
  | {
    outcome: 'download_denied';
    access: DepartmentFileViewAccess;
  };

export async function resolveFileActionAccess(
  file: Pick<FileItem, 'id' | 'spaceId' | 'isDepartmentFile'>,
  action: FileActionKind,
  loadAccess: (spaceId: number, fileId: number) => Promise<DepartmentFileViewAccess>,
): Promise<FileActionAccessDecision> {
  if (!file.isDepartmentFile) {
    return { outcome: 'proceed', access: null };
  }

  const access = await loadAccess(file.spaceId, file.id);
  if (access.status !== 'allowed') {
    return { outcome: 'show_access_gate', access };
  }
  if (action === 'download' && !access.canDownload) {
    return { outcome: 'download_denied', access };
  }
  return { outcome: 'proceed', access };
}
