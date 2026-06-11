from pydantic import BaseModel, Field


class PortalLoginRequest(BaseModel):
    account: str = Field(min_length=1)
    password: str = Field(min_length=1)
    remember: bool = True
    captcha_key: str = ""
    captcha: str = ""


class PortalUserView(BaseModel):
    account: str
    name: str
    initial: str = ""
    role: str = ""
    external_id: str = ""
    login_at: int


class PortalAuthData(BaseModel):
    user: PortalUserView


class PortalUnifiedAuthConfigData(BaseModel):
    enabled: bool
    provider: str
    label: str
    unavailable_reason: str = ""
