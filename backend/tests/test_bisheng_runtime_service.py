import asyncio
import base64
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.schemas.bisheng_runtime import BishengRuntimeConfigUpdate
from app.services.bisheng_runtime_service import (
    BishengRuntimeService,
    _decode_jwt_exp,
)


class FakeRuntimeBishengClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        api_token: str | None = None,
        *,
        asset_base_url: str | None = None,
    ):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.api_token = api_token
        self.asset_base_url = asset_base_url

    async def get_json(self, path: str, params=None):
        if path == "/api/v1/user/get_captcha":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {
                    "captcha_key": "cap-demo",
                    "user_capthca": False,
                    "captcha": "",
                },
            }
        if path == "/api/v1/user/public_key":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {"public_key": "fake-public-key"},
            }
        if path == "/api/v1/user/info":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {
                    "user_name": "portal-admin",
                    "nick_name": "门户服务账号",
                    "role_name": "管理员",
                },
            }
        raise AssertionError(f"Unexpected path: {path}")

    async def post_json(self, path: str, json=None):
        if path == "/api/v1/user/login":
            assert json["user_name"] == "portal-admin"
            assert json["password"] == "encrypted-password"
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {"access_token": "runtime-token"},
            }
        raise AssertionError(f"Unexpected path: {path}")

    async def aclose(self):
        return None


def create_runtime_service(config_path: Path) -> BishengRuntimeService:
    return BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_api_token="",
        client_factory=FakeRuntimeBishengClient,
        password_encryptor=lambda _public_key, _password: "encrypted-password",
    )


def test_runtime_service_logs_in_and_persists_token_without_password(tmp_path: Path):
    config_path = tmp_path / "bisheng_runtime.json"
    service = create_runtime_service(config_path)

    asyncio.run(service.initialize())
    result = asyncio.run(
        service.update_config(
            BishengRuntimeConfigUpdate(
                base_url="http://example.com",
                username="portal-admin",
                password="super-secret",
                timeout_seconds=45.0,
            )
        )
    )

    reloaded = create_runtime_service(config_path).get_public_config()

    assert result.username == "portal-admin"
    assert result.has_token is True
    assert not config_path.exists()
    assert (tmp_path / "portal.sqlite3").exists()
    assert reloaded.username == "portal-admin"
    assert reloaded.has_token is True
    assert reloaded.has_saved_password is True


def test_runtime_service_imports_legacy_json_once(tmp_path: Path):
    config_path = tmp_path / "bisheng_runtime.json"
    config_path.write_text(
        json.dumps(
            {
                "base_url": "http://legacy.example.com",
                "asset_base_url": "http://assets.example.com",
                "username": "legacy-admin",
                "timeout_seconds": 15.0,
                "api_token": "legacy-token",
                "last_auth_at": "2026-05-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    service = create_runtime_service(config_path)
    view = service.get_public_config()

    assert str(view.base_url) == "http://legacy.example.com/"
    assert view.asset_base_url == "http://assets.example.com"
    assert view.username == "legacy-admin"
    assert view.has_token is True

    config_path.write_text(
        json.dumps(
            {
                "base_url": "http://ignored.example.com",
                "username": "ignored-admin",
                "timeout_seconds": 30.0,
                "api_token": "ignored-token",
                "last_auth_at": "",
            }
        ),
        encoding="utf-8",
    )

    reloaded = create_runtime_service(config_path).get_public_config()
    assert str(reloaded.base_url) == "http://legacy.example.com/"
    assert reloaded.username == "legacy-admin"


def test_runtime_service_requires_password_when_endpoint_changes(tmp_path: Path):
    config_path = tmp_path / "bisheng_runtime.json"
    service = create_runtime_service(config_path)

    asyncio.run(service.initialize())

    try:
        asyncio.run(
            service.update_config(
                BishengRuntimeConfigUpdate(
                    base_url="http://changed.example.com",
                    username="portal-admin",
                    password="",
                    timeout_seconds=30.0,
                )
            )
        )
    except ValueError as err:
        assert "必须重新输入密码" in str(err)
    else:
        raise AssertionError("Expected ValueError when changing endpoint without password")


def test_auth_failure_refresh_uses_saved_plaintext_password(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    factory, state = _make_scripted_factory(
        login_tokens=["initial-token", "refreshed-token"]
    )

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        client_factory=factory,
        password_encryptor=lambda _public_key, password: f"encrypted-{password}",
    )

    async def _run():
        await service.update_config(
            BishengRuntimeConfigUpdate(
                base_url="http://example.com",
                username="portal-admin",
                password="super-secret",
                timeout_seconds=30.0,
            )
        )
        saved = service._read_config()
        raw_saved = saved.model_dump_json()
        assert saved.saved_password == "super-secret"
        assert "super-secret" in raw_saved
        state["last_login_payload"] = None
        refreshed = await service.refresh_token_after_auth_failure(saved.api_token)
        await service.aclose()
        return refreshed, saved

    refreshed_token, saved_config = asyncio.run(_run())

    assert refreshed_token != saved_config.api_token
    assert state["login_calls"] == 2
    assert state["last_login_payload"]["user_name"] == "portal-admin"
    assert state["last_login_payload"]["password"] == "encrypted-super-secret"


def test_auth_failure_refresh_reuses_token_refreshed_by_another_request(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    fresh = _make_fake_jwt(24 * 3600)
    _seed_runtime_config(config_path, api_token=fresh)
    factory, state = _make_scripted_factory(login_tokens=["unused"])

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_username="portal-admin",
        default_password="pwd",
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )

    token = asyncio.run(service.refresh_token_after_auth_failure("older-token"))

    assert token == fresh
    assert state["login_calls"] == 0


# ---------------- 自动续期相关测试 ----------------


def _make_fake_jwt(exp_delta_seconds: float) -> str:
    exp = int((datetime.now(timezone.utc) + timedelta(seconds=exp_delta_seconds)).timestamp())
    header_b64 = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps({"exp": exp}).encode()
    ).rstrip(b"=").decode()
    return f"{header_b64}.{payload_b64}.sig"


class _ScriptedBishengClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        api_token: str | None,
        state: dict,
        asset_base_url: str | None = None,
    ):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.api_token = api_token
        self.asset_base_url = asset_base_url
        self._state = state

    async def get_json(self, path, params=None):
        if path == "/api/v1/user/get_captcha":
            return {"status_code": 200, "data": {"captcha_key": "k", "user_capthca": False}}
        if path == "/api/v1/user/public_key":
            return {"status_code": 200, "data": {"public_key": "fake-public-key"}}
        if path == "/api/v1/user/info":
            self._state["user_info_calls"] += 1
            self._state["user_info_tokens"].append(self.api_token)
            if self._state["user_info_errors"]:
                err = self._state["user_info_errors"].pop(0)
                if err is not None:
                    raise err
            return {
                "status_code": 200,
                "data": {
                    "user_name": "portal-admin",
                    "nick_name": "门户服务账号",
                    "role_name": "管理员",
                    "external_id": "E1001",
                },
            }
        raise AssertionError(f"Unexpected get: {path}")

    async def post_json(self, path, json=None):
        if path == "/api/v1/user/login":
            self._state["login_calls"] += 1
            self._state["last_login_payload"] = json
            if self._state["errors"]:
                err = self._state["errors"].pop(0)
                if err is not None:
                    raise err
            token = self._state["tokens"].pop(0) if self._state["tokens"] else "next-token"
            return {"status_code": 200, "data": {"access_token": token}}
        raise AssertionError(f"Unexpected post: {path}")

    async def aclose(self):
        return None


class _AuthRefreshingInfoClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        api_token: str | None,
        state: dict,
        *,
        asset_base_url: str | None = None,
        auth_refresh_handler=None,
    ):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.api_token = api_token
        self.asset_base_url = asset_base_url
        self._state = state
        self._auth_refresh_handler = auth_refresh_handler

    async def get_json(self, path, params=None):
        if path == "/api/v1/user/get_captcha":
            return {"status_code": 200, "data": {"captcha_key": "k", "user_capthca": False}}
        if path == "/api/v1/user/public_key":
            return {"status_code": 200, "data": {"public_key": "fake-public-key"}}
        if path == "/api/v1/user/info":
            self._state["user_info_calls"] += 1
            if self.api_token == self._state["stale_token"]:
                self._state["refresh_attempts"] += 1
                if self._auth_refresh_handler is None:
                    raise AssertionError("Expected auth refresh handler")
                self.set_api_token(await self._auth_refresh_handler(self.api_token))
            return {
                "status_code": 200,
                "data": {
                    "user_name": "portal-admin",
                    "nick_name": "门户服务账号",
                    "role_name": "管理员",
                },
            }
        raise AssertionError(f"Unexpected get: {path}")

    async def post_json(self, path, json=None):
        if path == "/api/v1/user/login":
            self._state["login_calls"] += 1
            self._state["last_login_payload"] = json
            return {"status_code": 200, "data": {"access_token": self._state["refreshed_token"]}}
        raise AssertionError(f"Unexpected post: {path}")

    def set_api_token(self, token: str):
        self.api_token = token

    async def aclose(self):
        return None


def _make_scripted_factory(*, login_tokens=None, login_errors=None, user_info_errors=None):
    state = {
        "login_calls": 0,
        "last_login_payload": None,
        "tokens": list(login_tokens or []),
        "errors": list(login_errors or []),
        "user_info_calls": 0,
        "user_info_tokens": [],
        "user_info_errors": list(user_info_errors or []),
    }

    def factory(base_url, timeout_seconds, api_token=None, *, asset_base_url=None):
        return _ScriptedBishengClient(
            base_url,
            timeout_seconds,
            api_token,
            state,
            asset_base_url=asset_base_url,
        )

    return factory, state


def _make_auth_refreshing_info_factory(*, stale_token: str, refreshed_token: str):
    state = {
        "stale_token": stale_token,
        "refreshed_token": refreshed_token,
        "refresh_attempts": 0,
        "login_calls": 0,
        "last_login_payload": None,
        "user_info_calls": 0,
    }

    def factory(
        base_url,
        timeout_seconds,
        api_token=None,
        *,
        asset_base_url=None,
        auth_refresh_handler=None,
    ):
        return _AuthRefreshingInfoClient(
            base_url,
            timeout_seconds,
            api_token,
            state,
            asset_base_url=asset_base_url,
            auth_refresh_handler=auth_refresh_handler,
        )

    return factory, state


def _seed_runtime_config(path: Path, *, api_token: str, username: str = "admin") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "base_url": "http://example.com",
                "username": username,
                "timeout_seconds": 30.0,
                "api_token": api_token,
                "last_auth_at": "",
            }
        ),
        encoding="utf-8",
    )


def test_decode_jwt_exp_returns_aware_datetime():
    token = _make_fake_jwt(3600)
    exp = _decode_jwt_exp(token)
    assert exp is not None
    remaining = (exp - datetime.now(timezone.utc)).total_seconds()
    assert 3500 < remaining < 3700


def test_decode_jwt_exp_handles_invalid_inputs():
    assert _decode_jwt_exp("") is None
    assert _decode_jwt_exp("not.a.jwt") is None
    header = base64.urlsafe_b64encode(b"{}").rstrip(b"=").decode()
    payload_no_exp = base64.urlsafe_b64encode(b'{"sub":"x"}').rstrip(b"=").decode()
    assert _decode_jwt_exp(f"{header}.{payload_no_exp}.sig") is None


def test_initialize_fetches_runtime_account_info_with_configured_token(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    token = _make_fake_jwt(2 * 3600)
    _seed_runtime_config(config_path, api_token=token, username="portal-admin")
    factory, state = _make_scripted_factory()

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )

    async def _run():
        await service.initialize()
        view = service.get_public_config()
        await service.aclose()
        return view

    view = asyncio.run(_run())

    assert state["user_info_calls"] == 1
    assert state["user_info_tokens"] == [token]
    assert view.connected is True
    assert view.auth_message == "已连接"
    assert view.auth_user is not None
    assert view.auth_user.account == "portal-admin"
    assert view.auth_user.name == "门户服务账号"
    assert view.auth_user.role == "管理员"
    assert view.auth_user.external_id == "E1001"


def test_initialize_reports_disconnected_when_runtime_account_info_fails(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    token = _make_fake_jwt(2 * 3600)
    _seed_runtime_config(config_path, api_token=token, username="portal-admin")
    factory, state = _make_scripted_factory(user_info_errors=[ValueError("bad token")])

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )

    async def _run():
        await service.initialize()
        view = service.get_public_config()
        await service.aclose()
        return view

    view = asyncio.run(_run())

    assert state["user_info_calls"] == 1
    assert view.connected is False
    assert view.auth_user is None
    assert view.auth_message == "BiSheng 数据源登录信息获取失败：bad token"
    assert token not in view.auth_message


def test_initialize_does_not_deadlock_when_runtime_account_info_refreshes_token(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    stale_token = _make_fake_jwt(2 * 3600)
    refreshed_token = _make_fake_jwt(24 * 3600)
    _seed_runtime_config(config_path, api_token=stale_token, username="portal-admin")
    factory, state = _make_auth_refreshing_info_factory(
        stale_token=stale_token,
        refreshed_token=refreshed_token,
    )

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_username="portal-admin",
        default_password="pwd",
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )

    async def _run():
        await asyncio.wait_for(service.initialize(), timeout=1)
        view = service.get_public_config()
        saved = service._read_config()
        await service.aclose()
        return view, saved

    view, saved = asyncio.run(_run())

    assert state["user_info_calls"] == 1
    assert state["refresh_attempts"] == 1
    assert state["login_calls"] == 1
    assert state["last_login_payload"]["user_name"] == "portal-admin"
    assert saved.api_token == refreshed_token
    assert view.connected is True
    assert view.auth_user is not None
    assert view.auth_user.account == "portal-admin"


def test_refresh_skips_when_token_is_fresh(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    fresh = _make_fake_jwt(2 * 3600)
    _seed_runtime_config(config_path, api_token=fresh)
    factory, state = _make_scripted_factory(login_tokens=["never-used"])

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_username="admin",
        default_password="pwd",
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )
    asyncio.run(service._refresh_token_if_due())

    assert state["login_calls"] == 0
    assert service._read_config().api_token == fresh


def test_refresh_relogins_when_token_near_expiry(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    expiring = _make_fake_jwt(30 * 60)
    _seed_runtime_config(config_path, api_token=expiring)
    new_token = _make_fake_jwt(24 * 3600)
    factory, state = _make_scripted_factory(login_tokens=[new_token])

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_username="admin",
        default_password="pwd",
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )
    asyncio.run(service._refresh_token_if_due())

    assert state["login_calls"] == 1
    assert state["last_login_payload"]["user_name"] == "admin"
    saved = service._read_config()
    assert saved.api_token == new_token
    assert saved.last_auth_at != ""


def test_refresh_falls_back_to_default_username(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    _seed_runtime_config(config_path, api_token=_make_fake_jwt(30 * 60), username="")
    factory, state = _make_scripted_factory(login_tokens=[_make_fake_jwt(24 * 3600)])

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_username="env-admin",
        default_password="pwd",
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )
    asyncio.run(service._refresh_token_if_due())

    assert state["login_calls"] == 1
    assert state["last_login_payload"]["user_name"] == "env-admin"


def test_refresh_skipped_without_default_password(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    _seed_runtime_config(config_path, api_token=_make_fake_jwt(30 * 60))
    factory, state = _make_scripted_factory(login_tokens=["x"])

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_username="admin",
        default_password=None,
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )
    asyncio.run(service._refresh_token_if_due())
    assert state["login_calls"] == 0


def test_refresh_swallows_login_failure(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    expiring = _make_fake_jwt(30 * 60)
    _seed_runtime_config(config_path, api_token=expiring)
    factory, _state = _make_scripted_factory(login_errors=[ValueError("auth down")])

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_username="admin",
        default_password="pwd",
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )
    asyncio.run(service._refresh_token_if_due())

    assert service._read_config().api_token == expiring


def test_initialize_does_not_start_loop_without_password(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    _seed_runtime_config(config_path, api_token=_make_fake_jwt(2 * 3600))
    factory, _state = _make_scripted_factory()

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
    )

    async def _run():
        await service.initialize()
        task = service._refresh_task
        await service.aclose()
        return task

    assert asyncio.run(_run()) is None


def test_initialize_starts_and_aclose_cancels_loop_with_password(tmp_path: Path):
    config_path = tmp_path / "rt.json"
    _seed_runtime_config(config_path, api_token=_make_fake_jwt(2 * 3600))
    factory, _state = _make_scripted_factory()

    async def long_sleep(_seconds):
        await asyncio.sleep(3600)

    service = BishengRuntimeService(
        config_path=config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_username="admin",
        default_password="pwd",
        client_factory=factory,
        password_encryptor=lambda _pk, _p: "enc",
        sleeper=long_sleep,
    )

    async def _run():
        await service.initialize()
        task = service._refresh_task
        assert task is not None
        await service.aclose()
        return task

    task = asyncio.run(_run())
    assert task.done()
