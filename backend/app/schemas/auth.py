from pydantic import BaseModel, Field


class PortalLoginRequest(BaseModel):
    account: str = Field(min_length=1)
    password: str = Field(min_length=1)
    remember: bool = True
    captcha_key: str = ""
    captcha: str = ""
    force_login: bool = False


class PortalUserView(BaseModel):
    account: str
    name: str
    initial: str = ""
    role: str = ""
    department_name: str = ""
    external_id: str = ""
    user_id: int | None = None
    tenant_id: int | None = None
    # Org department admin from BiSheng department settings (not RBAC / portal site admin).
    is_department_admin: bool = False
    login_at: int


class PortalAuthData(BaseModel):
    user: PortalUserView
    auth_source: str = ""


class PortalRestExchangeRequest(BaseModel):
    token_id: str = Field(min_length=1)
    redirect: str = "/"
    remember: bool = True


class PortalRestLoginRequest(BaseModel):
    account: str = Field(min_length=1)
    password: str = Field(min_length=1)
    remember: bool = True
    redirect: str = "/"
    force_login: bool = False
    captcha_key: str = ""
    captcha: str = ""


class PortalUnifiedAuthConfigData(BaseModel):
    enabled: bool
    auth_mode: str = "none"
    provider: str = ""
    label: str = "统一身份认证"
    rest_token_id_param: str = "tokenId"
    unavailable_reason: str = ""
    missing_fields: list[str] = Field(default_factory=list)
