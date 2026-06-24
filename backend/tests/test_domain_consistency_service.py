from app.services.domain_consistency_service import parse_domain_code


def test_parse_domain_code_extracts_third_segment():
    assert parse_domain_code("SGGF-STD-PP-001") == "PP"


def test_parse_domain_code_uppercases_and_strips():
    assert parse_domain_code("  sggf-std-qm-1 ") == "QM"


def test_parse_domain_code_returns_empty_when_missing():
    assert parse_domain_code("") == ""


def test_parse_domain_code_returns_empty_when_malformed():
    assert parse_domain_code("SGGF-STD-PP") == ""   # 缺少序列段
    assert parse_domain_code("SGGF-STD--001") == ""  # 第3段为空
