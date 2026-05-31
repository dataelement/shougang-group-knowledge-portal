# 首钢集团知识门户

首钢知识门户 monorepo，包含：

- `frontend/`：React + Vite 前端站点，覆盖首页、搜索、业务域列表、详情页、问答页、应用页和后台配置页
- `backend/`：FastAPI BFF，提供门户配置、知识检索、详情、预览、相关推荐和问答代理接口

## 目录结构

```text
.
├── backend/   # FastAPI BFF
├── frontend/  # React + Vite 前端
├── deploy/    # 前后端 Dockerfile 与 nginx 配置
├── scripts/   # 辅助脚本
└── README.md
```

## 本地运行

### 1. 启动后端

要求：

- Python `>=3.11`
- 当前仓库后端已在 Python `3.13` 环境下验证通过

安装并运行：

```bash
cd backend
python3.13 -m venv .venv
./.venv/bin/pip install -e ".[dev]"
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8010
```

后端默认读取 `backend/.env` 中的 `PORTAL_*` 配置，并把门户配置持久化到：

- `backend/app/config/data/portal_config.json`
- `backend/app/config/data/bisheng_runtime.json`

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev
```

Vite 开发服务器默认将 `/api` 代理到 `http://localhost:8010`。如需改目标地址，可设置 `VITE_BACKEND_PROXY_TARGET`。
本地开发时，`/workspace/*` 也会走同源代理到 Bisheng，避免「我的知识」iframe 跨域；默认目标为：

- `VITE_BISHENG_WEB_PROXY_TARGET=http://192.168.106.171:3001`
- `VITE_BISHENG_API_PROXY_TARGET=http://192.168.106.171:7860`
- `VITE_BISHENG_MINIO_PROXY_TARGET=http://192.168.106.171:9000`

## 常用验证命令

前端：

```bash
cd frontend
npm test
npm run lint
npm run build
```

后端：

```bash
cd backend
./.venv/bin/python -m pytest
```

如果直接使用系统 Python 3.9 运行后端测试，会因为项目已使用 3.11+ 语法和标准库特性而失败；以 `backend/.venv` 为准。

## Docker 镜像构建

仓库在 `deploy/` 提供前后端 Dockerfile：

```text
deploy/
├── Dockerfile.portal-frontend   # node:20 编译 SPA → nginx:1.27 运行
├── Dockerfile.portal-backend    # python:3.11-slim，VOLUME 持久化数据目录
└── nginx/default.conf.template  # 默认反代 backend:8010，并同源反代 Bisheng /workspace
```

在仓库根构建并运行：

```bash
docker build -f deploy/Dockerfile.portal-backend  -t shougang/portal-backend:0.1.0  .
docker build -f deploy/Dockerfile.portal-frontend -t shougang/portal-frontend:0.1.0 .

docker network create portal-net
docker run -d --name backend --network portal-net \
  -e PORTAL_BISHENG_BASE_URL=http://192.168.106.115:8098 \
  -v /opt/portal-data:/app/app/config/data \
  shougang/portal-backend:0.1.0
docker run -d --name frontend --network portal-net -p 3001:80 \
  shougang/portal-frontend:0.1.0
```

可外挂的关键配置：

- 前端 nginx 配置：通过 `BISHENG_WEB_UPSTREAM`、`BISHENG_API_UPSTREAM`、`BISHENG_MINIO_UPSTREAM` 调整 Bisheng 同源反代目标；`BISHENG_MINIO_SIGNED_HOST` 必须与 BiSheng 后端 `object_storage.minio.sharepoint` 完全一致（不带 `http://` 或 `https://`），否则 MinIO 预签名 URL 会返回 `SignatureDoesNotMatch`；也可 `-v /path/to/my-nginx.conf:/etc/nginx/conf.d/default.conf:ro` 覆盖完整 nginx 配置
- 后端运行时数据：`-v /opt/portal-data:/app/app/config/data` —— 持久化 `portal_config.json` + `bisheng_runtime.json` + `uploads/`，容器重建不丢 admin 配置
- 后端环境变量：通过 `-e PORTAL_*=...` 注入 BiSheng 接入参数（完整变量见 `backend/app/settings.py`）
