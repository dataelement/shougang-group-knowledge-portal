const STATUS_MESSAGE_MAP: Record<number, string> = {
  400: '请求参数有误，请检查后重试。',
  401: '登录状态已失效，请重新登录。',
  403: '权限不足，请联系管理员。',
  404: '请求的内容不存在或已被删除。',
  408: '请求超时，请稍后重试。',
  409: '当前操作与已有数据冲突，请刷新后重试。',
  413: '文件过大，请压缩或更换文件后重试。',
  415: '文件类型不受支持，请更换文件后重试。',
  422: '提交内容格式不正确，请检查后重试。',
  500: '服务暂时不可用，请稍后重试。',
  502: '服务连接异常，请稍后重试。',
  503: '服务暂时不可用，请稍后重试。',
  504: '服务响应超时，请稍后重试。',
};

const TECHNICAL_MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/^(failed to fetch|load failed|network\s*error|network request failed|fetch failed)$/i, '网络请求失败，请检查网络连接后重试。'],
  [/(request timeout|timeout|timed out|aborted due to timeout)/i, '请求超时，请稍后重试。'],
  [/(invalid|incorrect).*(username|user|account|password)|(username|user|account|password).*(invalid|incorrect)|user not found|account not found|password error/i, '账号或密码错误，请检查后重试。'],
  [/(unauthorized|not authenticated|authentication credentials were not provided|token.*(expired|invalid)|invalid token)/i, '登录状态已失效，请重新登录。'],
  [/(forbidden|permission denied|access denied|not allowed)/i, '权限不足，请联系管理员。'],
  [/(not found|no such file|does not exist)/i, '请求的内容不存在或已被删除。'],
  [/(internal server error|server error)/i, '服务暂时不可用，请稍后重试。'],
  [/(bad gateway|service unavailable|gateway timeout)/i, '服务连接异常，请稍后重试。'],
  [/BiSheng 登录失败：HTTP \d+/i, 'BiSheng 登录失败，请稍后重试。'],
  [/连接 BiSheng 失败/i, '连接 BiSheng 失败，请稍后重试。'],
  [/BiSheng 数据源自动重登失败/i, 'BiSheng 登录状态刷新失败，请重新登录。'],
  [/invalid response format.*domains missing/i, '门户配置格式异常，请联系管理员。'],
  [/bisheng request failed/i, '大模型应用平台请求失败，请稍后重试。'],
  [/(failed to fetch home stats|home stats query failed|invalid home stats response)/i, '首页统计数据加载失败，请稍后重试。'],
  [/a file with the same name or content already exists/i, '该空间中已存在同名或相同内容的文件。'],
  [/preview_content_not_found/i, '未找到可预览内容。'],
  [/unexpected rsa public key format/i, '登录加密配置异常，请联系管理员。'],
  [/knowledge_space scope requires knowledge_space_id/i, '知识库范围参数异常，请重新选择知识库。'],
  [/telemetry query failed/i, '统计数据加载失败，请稍后重试。'],
  [/telemetry status invalid/i, '统计数据状态异常，请稍后重试。'],
];

function hasChineseText(value: string): boolean {
  return /[\u4e00-\u9fa5]/.test(value);
}

function getMessageFromUnknown(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return '';
}

export function normalizeUserFacingMessage(
  message: string | null | undefined,
  fallback = '操作失败，请稍后重试。',
  status?: number,
): string {
  const raw = String(message ?? '').trim();
  const lower = raw.toLowerCase();

  for (const [pattern, replacement] of TECHNICAL_MESSAGE_PATTERNS) {
    if (pattern.test(raw)) return replacement;
  }

  if (/^http\s+\d{3}$/i.test(raw) || /^请求失败：\d{3}$/.test(raw) || lower === 'request failed') {
    return STATUS_MESSAGE_MAP[status ?? Number(raw.match(/\d{3}/)?.[0])] ?? fallback;
  }

  if (!raw) return status ? STATUS_MESSAGE_MAP[status] ?? fallback : fallback;
  if (hasChineseText(raw)) return raw;
  return status ? STATUS_MESSAGE_MAP[status] ?? fallback : fallback;
}

export function normalizeUserFacingErrorMessage(
  error: unknown,
  fallback = '操作失败，请稍后重试。',
  status?: number,
): string {
  return normalizeUserFacingMessage(getMessageFromUnknown(error), fallback, status);
}
