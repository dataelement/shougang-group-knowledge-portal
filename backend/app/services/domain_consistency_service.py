from __future__ import annotations

from typing import Iterable

from app.schemas.knowledge import DomainRef, PublishPrecheckResult
from app.schemas.portal_config import DomainConfig


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


class DomainConsistencyService:
    def check(
        self,
        file_encoding: str,
        target_space_id: int,
        domains: Iterable[DomainConfig],
    ) -> PublishPrecheckResult:
        domains = list(domains)
        file_code = parse_domain_code(file_encoding)
        if not file_code:
            return PublishPrecheckResult(
                allowed=False,
                reason_code="FILE_CODE_MISSING",
                message="文件编码缺失或不规范，无法识别业务域，请先补全文件编码后再发布。",
                file_domain=None,
                space_domains=[],
            )

        space_domains = [
            d for d in domains
            if d.enabled and d.code.strip() and target_space_id in d.space_ids
        ]
        space_refs = [DomainRef(code=d.code.strip().upper(), name=d.name) for d in space_domains]
        space_codes = {ref.code for ref in space_refs}

        file_domain_name = next(
            (d.name for d in domains if d.code.strip().upper() == file_code),
            file_code,
        )
        file_ref = DomainRef(code=file_code, name=file_domain_name)

        if not space_codes:
            return PublishPrecheckResult(
                allowed=False,
                reason_code="SPACE_DOMAIN_UNCONFIGURED",
                message="目标公共空间未配置业务域，请联系管理员在后台为该空间绑定业务域后再发布。",
                file_domain=file_ref,
                space_domains=[],
            )

        if file_code in space_codes:
            return PublishPrecheckResult(
                allowed=True,
                reason_code="OK",
                message="",
                file_domain=file_ref,
                space_domains=space_refs,
            )

        space_names = "、".join(ref.name for ref in space_refs)
        return PublishPrecheckResult(
            allowed=False,
            reason_code="DOMAIN_MISMATCH",
            message=f"该文件属于「{file_domain_name}」业务域，与目标空间「{space_names}」业务域不一致，不允许发布。",
            file_domain=file_ref,
            space_domains=space_refs,
        )
