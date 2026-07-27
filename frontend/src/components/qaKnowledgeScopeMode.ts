import type { QaKnowledgeScope } from '../api/content';

export type QaKnowledgePickerMode = 'knowledge' | 'category';

export function emptyFilesScope(): Extract<QaKnowledgeScope, { mode: 'files' }> {
  return { mode: 'files', fileRefs: [], folderRefs: [], resolvedFileCount: 0 };
}

export function resolveActiveQaScope(
  mode: QaKnowledgePickerMode,
  knowledgeScope: QaKnowledgeScope,
  categoryScope: QaKnowledgeScope,
): QaKnowledgeScope {
  return mode === 'category' ? categoryScope : knowledgeScope;
}

export function isExplicitQaScope(scope: QaKnowledgeScope): boolean {
  if (scope.mode === 'knowledge_space') return scope.knowledgeSpaceIds.length > 0;
  if (scope.mode === 'files') {
    return scope.fileRefs.length > 0 || scope.folderRefs.length > 0;
  }
  return false;
}
