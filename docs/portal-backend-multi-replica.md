# Portal backend 多副本发布与回滚

## 适用范围

本文用于把 Portal backend 从单副本扩为两个跨节点副本。Banner 和应用图标由 Portal 代理到 BiSheng，再保存到 MinIO 公共桶；门户聚合配置仍以 BiSheng 数据库为真相源，Redis 只承载共享版本、缓存和失效通知。

仓库当前没有权威 Kubernetes Deployment 或 Helm chart。`deploy/k8s/portal-backend-values.example.yaml` 只是需要映射到实际发布平台的参数清单，不应建立第二套独立发布流程。

## 目标资源

| 项目 | 推荐值 | 当前上限 |
|---|---:|---:|
| Portal backend Pod | 2 | 3 |
| CPU request | 500m | — |
| CPU limit | 1 core | 不得低于 1 core |
| Memory request | 1 GiB | — |
| Memory limit | 2 GiB | RSS 接近 80% 时先排查增长 |

两个副本应按 `kubernetes.io/hostname` 优先分散到两个节点。滚动升级设置 `maxUnavailable: 0`、`maxSurge: 1`，PodDisruptionBudget 设置 `minAvailable: 1`。HPA 如后续启用，`maxReplicas` 不得超过 3。

## 发布前检查

1. 确认 BiSheng 已先发布 `/api/v1/shougang-portal/assets/{category}`，并验证 JPEG、PNG、WebP 能写入 MinIO 公共桶。
2. 确认 `PORTAL_APP_ENV=production`，`PORTAL_REDIS_URL` 从 Kubernetes Secret 注入；禁止把 Redis 密码写进 values 或日志。
3. 确认两个 Pod 使用相同的 `PORTAL_RUNTIME_CONFIG_SCOPE`。当前单租户部署使用 `tenant-1`。
4. 通过 BiSheng 门户配置内部接口导出配置 JSON，仅用于查找仍引用 `/uploads/` 的字段。导出文件应按敏感配置处理，不得提交到 Git。
5. 通知管理员：历史 `/uploads/...` 资源不迁移、不代理、不自动删除，升级后可能 404，需要在管理页面重新上传。

历史引用可在受控终端中检查：

```bash
curl --fail --silent \
  -H "Authorization: Bearer ${PORTAL_SERVICE_TOKEN}" \
  "${BISHENG_BASE_URL}/api/v1/shougang-portal/config/internal" \
  | jq '.. | strings | select(startswith("/uploads/"))'
```

命令输出不得包含 token；终端历史和临时文件按生产凭据规范清理。本步骤只读取配置，不复制或删除旧文件。

## 发布顺序

1. 发布 BiSheng 资源上传 API，保持 Portal backend 单副本。
2. 发布包含 Redis 配置协调器和 MinIO 上传代理的新 Portal backend，仍保持单副本。
3. 验证登录、配置读取/保存、Banner 上传、应用图标上传及 MinIO URL。
4. 把 Portal backend 扩为两个副本，确认 Pod A 与 Pod B 分布在不同节点。
5. 执行下方双 Pod smoke。
6. 管理员重新上传仍引用 `/uploads/` 的 Banner 和应用图标并保存配置。

## 双 Pod smoke

1. 固定请求到 Pod A，登录并保存一个可逆的门户标题变更。
2. 固定请求到 Pod B，读取配置并执行一次依赖新配置的请求；预期无需重启即可看到新版本。
3. 在 Pod A 上传 Banner，确认返回 MinIO URL。
4. 在 Pod B 上传应用图标，并从两个 Pod 分别访问两个 URL。
5. 删除 Pod A，确认 Pod B 的既有登录会话仍有效，配置读取和资源访问继续成功。
6. 重建 Pod A，确认其启动后版本与 Pod B 一致。
7. 检查日志/指标中的本地配置版本、共享版本、刷新来源、Redis listener 重连和资源上传结果；不得出现密码、token、带凭据 Redis URL 或 MinIO secret。

## 回滚

出现跨 Pod 配置异常时，先将 Portal backend 临时降为 `replicas=1`，保留 Redis 和数据库配置，不回退配置版本。

- 不删除新上传的 MinIO 对象。
- 不自动恢复 Portal 本地 `/uploads` 写入。
- 不删除旧节点目录或持久卷中的文件。
- 如需恢复旧 Portal 镜像，先确认旧版本能解析当前 BiSheng 门户配置模型。
- 配置内容回滚通过管理端保存一个新版本完成，不直接改写数据库历史版本。

## 观察与扩容

至少观察 Pod RSS、CPU、重启、OOMKilled、请求 P95、配置刷新失败、Redis 重连和上传失败。默认保持两个副本；只有在两节点剩余容量和实测 P95 支持时才人工增加到三个副本。
