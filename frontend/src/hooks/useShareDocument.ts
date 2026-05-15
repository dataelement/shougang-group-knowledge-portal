import { useCallback, useMemo, useState } from 'react';
import {
  ApiRequestError,
  createShareDocument,
  type FileItem,
  type ShareDocumentResult,
  type ShareDocumentType,
  type ShareDocumentVisibility,
} from '../api/content';

const DEFAULT_EXPIRE_SECONDS = 7 * 24 * 60 * 60;

function resolveShareUrl(link: string): string {
  if (!link) return '';
  if (/^https?:\/\//i.test(link)) return link;
  return `${window.location.origin}${link.startsWith('/') ? link : `/${link}`}`;
}

export function useShareDocument() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<FileItem | null>(null);
  const [shareType, setShareType] = useState<ShareDocumentType>('link');
  const [visibility, setVisibility] = useState<ShareDocumentVisibility>('department');
  const [allowDownload, setAllowDownload] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [expireSeconds, setExpireSeconds] = useState(DEFAULT_EXPIRE_SECONDS);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ShareDocumentResult | null>(null);

  const openShare = useCallback((nextFile: FileItem) => {
    setFile(nextFile);
    setOpen(true);
    setShareType('link');
    setVisibility('department');
    setAllowDownload(false);
    setPasswordEnabled(false);
    setPassword('');
    setExpireSeconds(DEFAULT_EXPIRE_SECONDS);
    setCreating(false);
    setError('');
    setResult(null);
  }, []);

  const closeShare = useCallback(() => {
    if (creating) return;
    setOpen(false);
    setFile(null);
    setError('');
    setResult(null);
  }, [creating]);

  const confirmShare = useCallback(async () => {
    if (!file || creating) return;
    setCreating(true);
    setError('');
    try {
      const nextResult = await createShareDocument({
        spaceId: file.spaceId,
        fileId: file.id,
        shareType,
        visibility,
        allowDownload,
        password: passwordEnabled ? password : '',
        expireSeconds,
      });
      setResult(nextResult);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) {
        setError('当前账号没有分享该文档的权限');
      } else {
        setError(err instanceof Error ? err.message : '分享创建失败');
      }
    } finally {
      setCreating(false);
    }
  }, [allowDownload, creating, expireSeconds, file, password, passwordEnabled, shareType, visibility]);

  const updateShareType = useCallback((value: ShareDocumentType) => {
    setShareType(value);
    setResult(null);
  }, []);

  const updateVisibility = useCallback((value: ShareDocumentVisibility) => {
    setVisibility(value);
    setResult(null);
  }, []);

  const updateAllowDownload = useCallback((value: boolean) => {
    setAllowDownload(value);
    setResult(null);
  }, []);

  const updatePasswordEnabled = useCallback((value: boolean) => {
    setPasswordEnabled(value);
    setResult(null);
  }, []);

  const updatePassword = useCallback((value: string) => {
    setPassword(value);
    setResult(null);
  }, []);

  const updateExpireSeconds = useCallback((value: number) => {
    setExpireSeconds(value);
    setResult(null);
  }, []);

  const modalProps = useMemo(() => ({
    open,
    file,
    shareType,
    visibility,
    allowDownload,
    passwordEnabled,
    password,
    expireSeconds,
    creating,
    error,
    result,
    shareUrl: resolveShareUrl(result?.link ?? ''),
    onShareTypeChange: updateShareType,
    onVisibilityChange: updateVisibility,
    onAllowDownloadChange: updateAllowDownload,
    onPasswordEnabledChange: updatePasswordEnabled,
    onPasswordChange: updatePassword,
    onExpireSecondsChange: updateExpireSeconds,
    onClose: closeShare,
    onConfirm: confirmShare,
  }), [
    allowDownload,
    closeShare,
    confirmShare,
    creating,
    error,
    expireSeconds,
    file,
    open,
    password,
    passwordEnabled,
    result,
    shareType,
    updateAllowDownload,
    updateExpireSeconds,
    updatePassword,
    updatePasswordEnabled,
    updateShareType,
    updateVisibility,
    visibility,
  ]);

  return {
    openShare,
    shareModalProps: modalProps,
  };
}
