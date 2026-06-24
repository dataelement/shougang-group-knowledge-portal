from app.services.domain_consistency_service import parse_domain_code, DomainConsistencyService
from app.schemas.portal_config import DomainConfig


def test_parse_domain_code_extracts_third_segment():
    assert parse_domain_code("SGGF-STD-PP-001") == "PP"


def test_parse_domain_code_uppercases_and_strips():
    assert parse_domain_code("  sggf-std-qm-1 ") == "QM"


def test_parse_domain_code_returns_empty_when_missing():
    assert parse_domain_code("") == ""


def test_parse_domain_code_returns_empty_when_malformed():
    assert parse_domain_code("SGGF-STD-PP") == ""   # 缺少序列段
    assert parse_domain_code("SGGF-STD--001") == ""  # 第3段为空


def _domain(name, code, space_ids, enabled=True):
    return DomainConfig(
        name=name, code=code, space_ids=space_ids,
        color="#1", bg="#2", icon="Factory", background_image="", enabled=enabled,
    )


def test_check_allows_when_file_code_matches_space_domain():
    domains = [_domain("生产", "PP", [104])]
    result = DomainConsistencyService().check("SGGF-STD-PP-001", 104, domains)
    assert result.allowed is True
    assert result.reason_code == "OK"
    assert result.file_domain.code == "PP"


def test_check_blocks_on_domain_mismatch():
    domains = [_domain("能源", "EM", [110]), _domain("生产", "PP", [104])]
    result = DomainConsistencyService().check("SGGF-STD-PP-001", 110, domains)
    assert result.allowed is False
    assert result.reason_code == "DOMAIN_MISMATCH"
    assert "生产" in result.message and "能源" in result.message


def test_check_blocks_when_file_code_missing():
    domains = [_domain("生产", "PP", [104])]
    result = DomainConsistencyService().check("", 104, domains)
    assert result.allowed is False
    assert result.reason_code == "FILE_CODE_MISSING"


def test_check_blocks_when_space_has_no_domain():
    domains = [_domain("生产", "PP", [104])]
    result = DomainConsistencyService().check("SGGF-STD-PP-001", 999, domains)
    assert result.allowed is False
    assert result.reason_code == "SPACE_DOMAIN_UNCONFIGURED"


def test_check_allows_when_space_bound_by_multiple_domains_hits_any():
    domains = [_domain("财务", "FI", [104]), _domain("生产", "PP", [104])]
    result = DomainConsistencyService().check("SGGF-STD-PP-001", 104, domains)
    assert result.allowed is True


def test_check_ignores_disabled_domains():
    domains = [_domain("生产", "PP", [104], enabled=False)]
    result = DomainConsistencyService().check("SGGF-STD-PP-001", 104, domains)
    assert result.reason_code == "SPACE_DOMAIN_UNCONFIGURED"
