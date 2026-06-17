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

## Docker 部署

仓库在 `deploy/` 提供前后端 Dockerfile：

```text
deploy/
├── Dockerfile.portal-frontend   # node:20 编译 SPA → nginx:1.27 运行
├── Dockerfile.portal-backend    # python:3.11-slim，VOLUME 持久化数据目录
└── nginx/default.conf.template  # 默认反代 backend:8010，并同源反代 Bisheng /workspace 与 MinIO 文件
```

### 1. 镜像构建

在仓库根目录执行：

```bash
docker build -f deploy/Dockerfile.portal-backend  -t shougang/portal-backend:0.1.0  .
docker build -f deploy/Dockerfile.portal-frontend -t shougang/portal-frontend:0.1.0 .
```

当前 `docker-compose.yaml` 默认使用内网镜像：

```text
192.168.106.8:6082/dataelement/shougang-portal-backend:master
192.168.106.8:6082/dataelement/shougang-portal-frontend:master
```

如果改用本地构建镜像，需要同步调整 `docker-compose.yaml` 中两个 `image` 字段，或在部署机上提前把对应镜像 tag 推送到可访问的镜像仓库。

### 2. 使用 Docker Compose 部署

推荐在部署机固定目录保存仓库和运行数据，例如：

```text
/opt/code/shougang-group-knowledge-portal   # 项目代码与 docker-compose.yaml
/opt/portal-data                            # 后端运行时数据，挂载到容器内 /app/app/config/data
```

首次部署：

```bash
cd /opt/code/shougang-group-knowledge-portal
mkdir -p /opt/portal-data
docker compose pull
docker compose up -d
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f portal-backend
docker compose logs -f portal-frontend
```

停止、重启和升级：

```bash
# 停止服务，不删除 /opt/portal-data
docker compose down

# 重启单个服务
docker compose up -d portal-frontend
docker compose up -d portal-backend

# 拉取新镜像并重建容器
docker compose pull
docker compose up -d
```

`/opt/portal-data` 会保存门户后台配置、运行时配置、SQLite 数据库和上传文件。容器重建不会删除这些数据；只有手动删除该目录才会清空运行时数据。

### 3. 使用 docker run 手动运行

如不使用 Compose，可手动创建网络并运行两个容器：

```bash
docker network create portal-net

docker run -d --name backend --network portal-net \
  -e PORTAL_APP_ENV=production \
  -e PORTAL_BISHENG_BASE_URL=http://192.168.106.171:7860 \
  -v /opt/portal-data:/app/app/config/data \
  shougang/portal-backend:0.1.0

docker run -d --name frontend --network portal-net -p 3002:80 \
  -e BISHENG_WEB_UPSTREAM=http://192.168.106.171:3001 \
  -e BISHENG_API_UPSTREAM=http://192.168.106.171:7860 \
  -e BISHENG_MINIO_UPSTREAM=http://192.168.106.171:9100 \
  -e BISHENG_MINIO_SIGNED_HOST=minio:9000 \
  shougang/portal-frontend:0.1.0
```

### 4. 环境变量说明

后端变量由 `PORTAL_` 前缀控制：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORTAL_APP_ENV` | `development` | 运行环境。Compose 中默认设为 `production`。 |
| `PORTAL_BISHENG_BASE_URL` | `http://localhost:7860` | BiSheng 后端 API 地址，门户后端调用知识库、问答等接口使用。 |
| `PORTAL_BISHENG_TIMEOUT_SECONDS` | `30` | 门户后端请求 BiSheng 的超时时间。 |
| `PORTAL_BISHENG_API_TOKEN` | 空 | 可选。配置后会作为 `Authorization: Bearer` 和 `access_token_cookie` 传给 BiSheng。 |
| `PORTAL_BISHENG_USERNAME` | 空 | 可选。系统数据源账号；用于 token 自动续期和认证失败后的自动重登。 |
| `PORTAL_BISHENG_PASSWORD` | 空 | 可选。系统数据源密码；用于 token 自动续期和认证失败后的自动重登。 |
| `PORTAL_BISHENG_DEFAULT_MODEL` | 空 | 可选。问答默认模型。 |
| `PORTAL_BISHENG_PAGE_SIZE_LIMIT` | `100` | 知识列表分页上限。 |

前端容器内 Nginx 变量控制同源代理：

| 变量 | Compose 默认值 | 说明 |
| --- | --- | --- |
| `BISHENG_WEB_UPSTREAM` | `http://bisheng-frontend:3001` | `/workspace/` 代理目标，用于嵌入“我的知识”页面。 |
| `BISHENG_API_UPSTREAM` | `http://bisheng-backend:7860` | `/workspace/api/` 代理目标，用于“我的知识”页面调用 BiSheng API。 |
| `BISHENG_MINIO_UPSTREAM` | `http://192.168.106.171:9100` | `/bisheng/`、`/workspace/bisheng/`、`/tmp-dir` 文件代理目标，通常指向 MinIO 可访问地址。 |
| `BISHENG_MINIO_SIGNED_HOST` | `minio:9000` | 转发 MinIO 预签名 URL 时使用的 `Host` 头，必须与 BiSheng 生成签名时的 sharepoint Host 一致。 |
| `PORTAL_BACKEND_PORT` | `8010` | 后端容器映射到宿主机的端口。 |
| `PORTAL_FRONTEND_PORT` | `3002` | 前端 Nginx 映射到宿主机的端口。 |

admin 页面保存的数据源密码会以明文写入 `portal.sqlite3`，用于后续 token 自动续期和认证失败后的自动重登。请限制该数据库文件的读取权限，并避免把运行时数据目录提交到代码仓库。

### 5. MinIO 预签名 URL 配置要求

文件预览和下载使用 BiSheng 返回的 MinIO 预签名 URL。S3 预签名 URL 会把 `host` 纳入签名计算，因此门户 Nginx 转发时的 `Host` 必须和 BiSheng 生成签名时使用的 Host 完全一致。

检查 BiSheng 后端容器中的 MinIO 配置：

```bash
docker exec bisheng-backend env | grep -E 'BS_MINIO_(ENDPOINT|SHAREPOINT|SCHEMA)'
```

如果输出类似：

```text
BS_MINIO_ENDPOINT=minio:9000
BS_MINIO_SHAREPOINT=minio:9000
BS_MINIO_SCHEMA=false
```

则门户前端应配置：

```bash
BISHENG_MINIO_UPSTREAM=http://192.168.106.171:9100
BISHENG_MINIO_SIGNED_HOST=minio:9000
```

含义是：

- `BISHENG_MINIO_UPSTREAM`：Nginx 实际连接的 MinIO 地址，必须从门户前端容器内可访问。
- `BISHENG_MINIO_SIGNED_HOST`：Nginx 转发给 MinIO 的 `Host` 请求头，必须等于 `BS_MINIO_SHAREPOINT` 去掉协议后的 Host。

如果 `BISHENG_MINIO_SIGNED_HOST` 配错，预览或下载会返回：

```text
SignatureDoesNotMatch
The request signature we calculated does not match the signature you provided.
```

修改后需要重建或重启前端容器，使 Nginx 模板重新渲染：

```bash
docker compose up -d portal-frontend
docker exec shougang-portal-frontend grep -n -A8 'location ~' /etc/nginx/conf.d/default.conf
```

确认渲染后的配置中包含：

```nginx
proxy_set_header   Host              minio:9000;
```

### 6. 部署后验证

服务启动后先检查容器状态：

```bash
docker compose ps
```

后端健康检查：

```bash
curl -i http://127.0.0.1:8010/health
curl -i http://127.0.0.1:3002/health
```

前端页面检查：

```bash
curl -I http://127.0.0.1:3002/
curl -I 'http://127.0.0.1:3002/search?page=1'
curl -I 'http://127.0.0.1:3002/knowledge-spaces'
```

文件预览链路检查：

1. 打开搜索页或“我的知识”页面，触发一次 PDF、Word、Excel 等文件预览。
2. 在前端容器日志中确认文件请求返回 `200` 或浏览器缓存命中 `304`：

```bash
docker logs --tail 200 shougang-portal-frontend | grep -E 'GET /workspace/bisheng/|GET /bisheng/|GET /tmp-dir'
```

3. 如果仍返回 `403`，优先检查 `BISHENG_MINIO_SIGNED_HOST` 是否等于 BiSheng 的 `BS_MINIO_SHAREPOINT`。

### 7. 常见问题

#### 预览或下载返回 `SignatureDoesNotMatch`

原因是 MinIO 预签名 URL 的签名 Host 与 Nginx 转发 Host 不一致。

处理步骤：

```bash
docker exec bisheng-backend env | grep BS_MINIO_SHAREPOINT
docker exec shougang-portal-frontend grep 'proxy_set_header   Host' /etc/nginx/conf.d/default.conf
```

两边 Host 必须一致。修改 `docker-compose.yaml` 或环境变量后执行：

```bash
docker compose up -d portal-frontend
```

#### 搜索结果可以打开，但“我的知识”页面无法加载

先确认 `/workspace/` 是否代理到正确的 BiSheng 前端：

```bash
docker exec shougang-portal-frontend grep -n -A12 'location /workspace/' /etc/nginx/conf.d/default.conf
```

`BISHENG_WEB_UPSTREAM` 应指向 BiSheng 前端服务，`BISHENG_API_UPSTREAM` 应指向 BiSheng 后端服务。如果 BiSheng 前端返回了绝对静态资源路径，还需要检查浏览器网络面板中是否有 `/assets/...` 资源 `404`。

#### 后台配置或上传文件在容器重建后丢失

确认后端数据目录已挂载：

```bash
docker inspect shougang-portal-backend --format '{{json .Mounts}}'
```

应能看到宿主机 `/opt/portal-data` 挂载到容器 `/app/app/config/data`。该目录至少会包含：

- `portal_config.json`
- `bisheng_runtime.json`
- `portal.sqlite3`
- `uploads/`
