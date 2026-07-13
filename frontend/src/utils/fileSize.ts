/**
 * 文件大小格式化:后端 file_size 为字节数(bisheng 存 int bytes)。
 * - 空值 → 返回空串(调用方决定占位)
 * - 已带单位(含字母,如 "1.2 MB")→ 原样返回
 * - 纯数字 → 按 1024 进制格式化为 B/KB/MB/GB/TB
 */
export function formatFileSize(value?: string | number | null): string {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str) return '';
  if (/[a-zA-Z]/.test(str)) return str;

  const bytes = Number(str);
  if (!Number.isFinite(bytes) || bytes < 0) return str;
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** index;
  const rounded = index === 0 ? size : Math.round(size * 100) / 100;
  return `${rounded} ${units[index]}`;
}
