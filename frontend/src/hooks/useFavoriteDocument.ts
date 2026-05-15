import { useCallback, useMemo, useState } from 'react';
import {
  ApiRequestError,
  favoriteDocument,
  fetchPersonalKnowledgeSpaces,
  type FileItem,
  type PersonalKnowledgeSpace,
} from '../api/content';

export function useFavoriteDocument() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<FileItem | null>(null);
  const [spaces, setSpaces] = useState<PersonalKnowledgeSpace[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadPersonalSpaces = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchPersonalKnowledgeSpaces();
      setSpaces(result.data);
      setSelectedSpaceId(result.data[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '个人知识库加载失败');
      setSpaces([]);
      setSelectedSpaceId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const openFavorite = useCallback((nextFile: FileItem) => {
    setFile(nextFile);
    setOpen(true);
    setSuccess('');
    setError('');
    void loadPersonalSpaces();
  }, [loadPersonalSpaces]);

  const closeFavorite = useCallback(() => {
    if (saving) return;
    setOpen(false);
    setFile(null);
    setSuccess('');
    setError('');
  }, [saving]);

  const confirmFavorite = useCallback(async () => {
    if (!file || !selectedSpaceId || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await favoriteDocument({
        sourceSpaceId: file.spaceId,
        sourceFileId: file.id,
        targetSpaceId: selectedSpaceId,
      });
      setSuccess('收藏成功');
      setOpen(false);
      setFile(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setError('该文档已收藏到所选个人知识库');
      } else {
        setError(err instanceof Error ? err.message : '收藏失败');
      }
    } finally {
      setSaving(false);
    }
  }, [file, saving, selectedSpaceId]);

  const modalProps = useMemo(() => ({
    open,
    file,
    spaces,
    selectedSpaceId,
    loading,
    saving,
    error,
    success,
    onSelectSpace: setSelectedSpaceId,
    onClose: closeFavorite,
    onConfirm: confirmFavorite,
  }), [closeFavorite, confirmFavorite, error, file, loading, open, saving, selectedSpaceId, spaces, success]);

  return {
    openFavorite,
    favoriteModalProps: modalProps,
  };
}
