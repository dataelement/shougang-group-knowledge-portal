from __future__ import annotations

import re


STATUS_MESSAGE_MAP = {
    400: "请求参数有误，请检查后重试",
    401: "登录状态已失效，请重新登录",
    403: "权限不足，请联系管理员",
    404: "请求的内容不存在或已被删除",
    408: "请求超时，请稍后重试",
    409: "当前操作与已有数据冲突，请刷新后重试",
    413: "文件过大，请压缩或更换文件后重试",
    415: "文件类型不受支持，请更换文件后重试",
    422: "提交内容格式不正确，请检查后重试",
    500: "服务暂时不可用，请稍后重试",
    502: "服务连接异常，请稍后重试",
    503: "服务暂时不可用，请稍后重试",
    504: "服务响应超时，请稍后重试",
}

TECHNICAL_MESSAGE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"^(failed to fetch|load failed|network\s*error|network request failed|fetch failed)$", re.I),
        "网络请求失败，请检查网络连接后重试",
    ),
    (re.compile(r"(request timeout|timeout|timed out|aborted due to timeout)", re.I), "请求超时，请稍后重试"),
    (
        re.compile(
            r"(invalid|incorrect).*(username|user|account|password)|(username|user|account|password).*(invalid|incorrect)|user not found|account not found|password error",
            re.I,
        ),
        "账号或密码错误，请检查后重试",
    ),
    (
        re.compile(
            r"(unauthorized|not authenticated|authentication credentials were not provided|token.*(expired|invalid)|invalid token)",
            re.I,
        ),
        "登录状态已失效，请重新登录",
    ),
    (re.compile(r"(forbidden|permission denied|access denied|not allowed)", re.I), "权限不足，请联系管理员"),
    (re.compile(r"(not found|no such file|does not exist)", re.I), "请求的内容不存在或已被删除"),
    (re.compile(r"(internal server error|server error)", re.I), "服务暂时不可用，请稍后重试"),
    (re.compile(r"(bad gateway|service unavailable|gateway timeout)", re.I), "服务连接异常，请稍后重试"),
    (re.compile(r"BiSheng 登录失败：HTTP \d+", re.I), "BiSheng 登录失败，请稍后重试"),
    (re.compile(r"连接 BiSheng 失败", re.I), "连接 BiSheng 失败，请稍后重试"),
    (re.compile(r"BiSheng 数据源自动重登失败", re.I), "BiSheng 登录状态刷新失败，请重新登录"),
    (re.compile(r"invalid response format.*domains missing", re.I), "门户配置格式异常，请联系管理员"),
    (re.compile(r"bisheng request failed", re.I), "大模型应用平台请求失败，请稍后重试"),
    (
        re.compile(r"(failed to fetch home stats|home stats query failed|invalid home stats response)", re.I),
        "首页统计数据加载失败，请稍后重试",
    ),
    (re.compile(r"a file with the same name or content already exists", re.I), "该空间中已存在同名或相同内容的文件"),
    (re.compile(r"preview_content_not_found", re.I), "未找到可预览内容"),
    (re.compile(r"unexpected rsa public key format", re.I), "登录加密配置异常，请联系管理员"),
    (re.compile(r"knowledge_space scope requires knowledge_space_id", re.I), "知识库范围参数异常，请重新选择知识库"),
    (re.compile(r"invalid business domain code", re.I), "业务域编码无效，请从业务域编码候选中选择"),
    (re.compile(r"telemetry query failed", re.I), "统计数据加载失败，请稍后重试"),
    (re.compile(r"telemetry status invalid", re.I), "统计数据状态异常，请稍后重试"),
)


def normalize_user_facing_message(
    message: object,
    *,
    fallback: str = "操作失败，请稍后重试",
    status_code: int | None = None,
) -> str:
    raw = str(message or "").strip()
    lower = raw.lower()

    for pattern, replacement in TECHNICAL_MESSAGE_PATTERNS:
        if pattern.search(raw):
            return replacement

    status_from_text = _status_from_text(raw)
    if (
        re.fullmatch(r"http\s+\d{3}", raw, re.I)
        or re.fullmatch(r"请求失败：\d{3}", raw)
        or lower == "request failed"
    ):
        return STATUS_MESSAGE_MAP.get(status_code or status_from_text, fallback)

    if not raw:
        return STATUS_MESSAGE_MAP.get(status_code, fallback) if status_code else fallback
    if _has_chinese_text(raw):
        return raw
    return STATUS_MESSAGE_MAP.get(status_code, fallback) if status_code else fallback


def _has_chinese_text(value: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fa5]", value))


def _status_from_text(value: str) -> int | None:
    match = re.search(r"\d{3}", value)
    return int(match.group(0)) if match else None
