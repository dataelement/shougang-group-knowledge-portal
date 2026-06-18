import type { QaKnowledgeFileRef, QaKnowledgeFolderRef, QaKnowledgeScope } from '../api/content';

type FilesScope = Extract<QaKnowledgeScope, { mode: 'files' }>;

export function fileRefKey(spaceId: number, fileId: number) {
  return `${spaceId}:${fileId}`;
}

export function folderRefKey(spaceId: number, folderId: number) {
  return `${spaceId}:${folderId}`;
}

function dedupeFileRefs(fileRefs: QaKnowledgeFileRef[]): QaKnowledgeFileRef[] {
  const seen = new Set<string>();
  const normalized: QaKnowledgeFileRef[] = [];
  for (const ref of fileRefs) {
    const key = fileRefKey(ref.knowledgeSpaceId, ref.fileId);
    if (seen.has(key)) continue;
    normalized.push(ref);
    seen.add(key);
  }
  return normalized;
}

function dedupeFolderRefs(folderRefs: QaKnowledgeFolderRef[]): QaKnowledgeFolderRef[] {
  const seen = new Set<string>();
  const normalized: QaKnowledgeFolderRef[] = [];
  for (const ref of folderRefs) {
    const key = folderRefKey(ref.knowledgeSpaceId, ref.folderId);
    if (seen.has(key)) continue;
    normalized.push({
      ...ref,
      fileRefs: ref.fileRefs ? dedupeFileRefs(ref.fileRefs) : undefined,
      resolvedFileCount: Math.max(ref.resolvedFileCount ?? 0, 0),
    });
    seen.add(key);
  }
  return normalized;
}

export function getResolvedFileCount(
  fileRefs: QaKnowledgeFileRef[],
  folderRefs: QaKnowledgeFolderRef[],
): number {
  const explicitFileKeys = new Set(dedupeFileRefs(fileRefs).map((ref) => fileRefKey(ref.knowledgeSpaceId, ref.fileId)));
  const knownFolderFileKeys = new Set<string>();
  let unknownFolderEstimate = 0;

  for (const folderRef of dedupeFolderRefs(folderRefs)) {
    if (folderRef.fileRefs?.length) {
      for (const fileRef of folderRef.fileRefs) {
        knownFolderFileKeys.add(fileRefKey(fileRef.knowledgeSpaceId, fileRef.fileId));
      }
      continue;
    }
    unknownFolderEstimate += Math.max(folderRef.resolvedFileCount ?? 0, 0);
  }

  let explicitOutsideKnownFolders = 0;
  for (const key of explicitFileKeys) {
    if (!knownFolderFileKeys.has(key)) {
      explicitOutsideKnownFolders += 1;
    }
  }

  return knownFolderFileKeys.size + explicitOutsideKnownFolders + unknownFolderEstimate;
}

export function buildFilesScope(
  fileRefs: QaKnowledgeFileRef[],
  folderRefs: QaKnowledgeFolderRef[],
): FilesScope {
  const normalizedFileRefs = dedupeFileRefs(fileRefs);
  const normalizedFolderRefs = dedupeFolderRefs(folderRefs);
  return {
    mode: 'files',
    fileRefs: normalizedFileRefs,
    folderRefs: normalizedFolderRefs,
    resolvedFileCount: getResolvedFileCount(normalizedFileRefs, normalizedFolderRefs),
  };
}
