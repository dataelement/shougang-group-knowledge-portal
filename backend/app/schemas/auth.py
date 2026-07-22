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
    login_at: int


class PortalAuthData(BaseModel):
    user: PortalUserView


class PortalUnifiedAuthConfigData(BaseModel):
    enabled: bool
    provider: str
    label: str
    unavailable_reason: str = ""
    missing_fields: list[str] = Field(default_factory=list)
