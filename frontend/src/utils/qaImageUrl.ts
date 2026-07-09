/**
 * 专家问答上传的图片地址是 bisheng 返回的 minio 预签名 URL,
 * host 指向内部 docker 地址(如 http://minio:9000/tmp-dir/xxx?X-Amz-...),
 * 浏览器无法直接访问。这里改写成相对路径,交给前端 nginx 的 minio 反代
 * (/tmp-dir、/bisheng 等前缀)处理;预签名 query 原样保留,签名依旧有效。
 */
const MINIO_PROXY_PREFIXES = ['/tmp-dir', '/bisheng', '/skm-bisheng', '/workspace/bisheng'];

export function resolveQaImageUrl(url: string | null | undefined): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return '';
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(trimmed, origin);
    if (MINIO_PROXY_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // 非法 URL,原样返回
  }
  return trimmed;
}
