from __future__ import annotations


def parse_domain_code(file_encoding: str) -> str:
    """从文件编码提取业务域 code（第 3 段）。

    文件编码格式 ``SGGF-STD-{CODE}-{SEQ}``，如 ``SGGF-STD-PP-001`` -> ``PP``。
    缺失或格式非法时返回空串。
    """
    if not file_encoding:
        return ""
    parts = [segment.strip() for segment in file_encoding.strip().split("-")]
    if len(parts) < 4 or not parts[2]:
        return ""
    return parts[2].upper()
