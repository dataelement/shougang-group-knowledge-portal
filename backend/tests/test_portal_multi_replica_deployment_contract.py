from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
VALUES_EXAMPLE = (
    PROJECT_ROOT / "deploy" / "k8s" / "portal-backend-values.example.yaml"
)
OPERATIONS_GUIDE = (
    PROJECT_ROOT / "docs" / "portal-backend-multi-replica.md"
)


def test_values_example_enforces_current_capacity_and_availability_contract():
    content = VALUES_EXAMPLE.read_text(encoding="utf-8")

    assert "replicaCount: 2" in content
    assert "maxReplicas: 3" in content
    assert "cpu: 500m" in content
    assert "cpu: \"1\"" in content
    assert "memory: 1Gi" in content
    assert "memory: 2Gi" in content
    assert "maxUnavailable: 0" in content
    assert "topology.kubernetes.io/zone" not in content
    assert "kubernetes.io/hostname" in content
    assert "PORTAL_REDIS_URL" in content
    assert "secretKeyRef" in content


def test_operations_guide_records_legacy_boundary_and_rollback():
    content = OPERATIONS_GUIDE.read_text(encoding="utf-8")

    assert "不迁移" in content
    assert "/uploads/" in content
    assert "重新上传" in content
    assert "replicas=1" in content
    assert "BiSheng" in content
    assert "MinIO" in content
    assert "Pod A" in content
    assert "Pod B" in content
