# 测试环境门户更新部署流程

适用环境：`192.168.106.171`  
门户地址：`http://192.168.106.171:3002`  
代码目录：`/opt/code/shougang-group-knowledge-portal`

## 1. 环境信息

| 项目 | 值 |
| --- | --- |
| SSH | `ssh root@192.168.106.171` |
| Codex SSH 别名 | `shougang-test-171` |
| 前端服务 | `portal-frontend` / `shougang-portal-frontend` |
| 后端服务 | `portal-backend` / `shougang-portal-backend` |
| 前端镜像 | `192.168.106.8:6082/dataelement/shougang-portal-frontend:master` |
| 后端镜像 | `192.168.106.8:6082/dataelement/shougang-portal-backend:master` |

## 2. 部署前检查

登录服务器并进入项目目录：

```bash
ssh root@192.168.106.171
cd /opt/code/shougang-group-knowledge-portal
```

检查分支、提交号和工作区状态：

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --short
```

检查容器状态：

```bash
docker compose -f docker-compose.yaml ps portal-frontend portal-backend
```

如果 `git status --short` 显示 `M docker-compose.yaml`，先确认它是测试环境本地配置：

```bash
git diff -- docker-compose.yaml
```

测试环境的 `docker-compose.yaml` 通常包含后端代码映射：

```yaml
- /opt/code/shougang-group-knowledge-portal/backend:/app
```

不要使用 `git reset --hard` 或 `git checkout -- docker-compose.yaml` 覆盖该配置。

## 3. 更新部署

拉取代码：

```bash
git pull --ff-only
```

构建前端镜像：

```bash
docker build --pull=false \
  -f deploy/Dockerfile.portal-frontend \
  -t 192.168.106.8:6082/dataelement/shougang-portal-frontend:master .
```

重建前端容器：

```bash
docker compose -f docker-compose.yaml up -d portal-frontend
```

重启后端容器：

```bash
docker compose -f docker-compose.yaml restart portal-backend
```

## 4. 部署后验证

检查容器是否正常运行：

```bash
docker compose -f docker-compose.yaml ps portal-frontend portal-backend
```

检查门户首页是否返回 `200 OK`：

```bash
curl -sS -I --max-time 10 http://127.0.0.1:3002
```

浏览器访问：

```text
http://192.168.106.171:3002
```

如需查看日志：

```bash
docker compose -f docker-compose.yaml logs --tail=100 portal-frontend
docker compose -f docker-compose.yaml logs --tail=200 portal-backend
```

## 5. 快速命令

确认工作区没有异常未提交文件后，可直接执行：

```bash
cd /opt/code/shougang-group-knowledge-portal

git pull --ff-only

docker build --pull=false \
  -f deploy/Dockerfile.portal-frontend \
  -t 192.168.106.8:6082/dataelement/shougang-portal-frontend:master .

docker compose -f docker-compose.yaml up -d portal-frontend
docker compose -f docker-compose.yaml restart portal-backend

docker compose -f docker-compose.yaml ps portal-frontend portal-backend
curl -sS -I --max-time 10 http://127.0.0.1:3002
```

## 6. 停止条件

遇到以下情况不要继续执行，先确认原因：

- `git pull --ff-only` 失败。
- `git pull` 提示本地文件会被覆盖，尤其是 `docker-compose.yaml`。
- 前端镜像构建失败。
- `portal-frontend` 或 `portal-backend` 启动后不是 `Up` 状态。
- `curl http://127.0.0.1:3002` 未返回 `200 OK`。
