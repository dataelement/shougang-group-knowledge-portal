import { useCallback, useMemo, useState } from 'react';
import type { FileItem } from '../api/content';

export function useDocumentQa() {
  const [file, setFile] = useState<FileItem | null>(null);

  const openDocumentQa = useCallback((nextFile: FileItem) => {
    setFile(nextFile);
  }, []);

  const closeDocumentQa = useCallback(() => {
    setFile(null);
  }, []);

  const documentQaModalProps = useMemo(() => ({
    open: Boolean(file),
    file,
    onClose: closeDocumentQa,
  }), [closeDocumentQa, file]);

  return {
    openDocumentQa,
    documentQaModalProps,
  };
}
