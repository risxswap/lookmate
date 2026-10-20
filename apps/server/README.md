# 用户服务端

Java 21 + Spring Boot 单 Maven 工程，根包 `cc.riskswap.lookmate`。已实现登录注册、Redis 会话、内存限流、统一错误响应与数据库结构检查；其他业务模块尚未实施。

## 本地启动

使用 Java 21，将 JAVA_HOME 指向对应安装目录。在 `apps/server/` 运行：

```sh
./mvnw verify
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

应用现在需要可用的 MySQL、Redis 和完成 V1 迁移的数据库。启动只读检查迁移历史与认证所需字段，不自动迁移或建库。通过根目录 [ops](../../ops/README.md) 显式迁移；本轮仅对隔离测试库执行过迁移，既有 `.env.dev` 中的 lookmate 库未改动。

`dev` profile 从当前工作目录加载 `.env.dev`，为 Java properties 格式，不可通过 shell source。IDE 工作目录应为 `apps/server`；也可用 `LOOKMATE_DEV_CONFIG` 指定配置文件绝对路径。复制 `.env.dev.example` 后填写连接信息，凭据文件权限设为 600，禁止提交。

默认监听 `127.0.0.1:8080`。打包后运行：

```sh
java -jar target/lookmate-server.jar --spring.profiles.active=dev
```

运行中的 JAR 不应被构建覆盖；重新构建前停进程，或将产物复制到独立运行目录。

## 认证与配置

接口和失败行为见 [登录注册需求](../../docs/02-需求文档/2026-10-20-登录注册/01-需求说明.md)。生产默认关闭注册，Cookie 为 Secure、HttpOnly、SameSite=Lax；dev 显式开启注册并关闭 Secure 以支持本地 HTTP。未启用默认账号、表单登录或 HTTP Basic，所有写接口保留 CSRF。

| 配置 | 默认值 |
| --- | --- |
| lookmate.auth.registration-enabled | false；dev 为 true |
| spring.session.timeout | 2h |
| spring.session.data.redis.namespace | lookmate:server:sessions |
| lookmate.auth.absolute-timeout | 7d |
| lookmate.auth.login-requests / login-window | 30 / 1m |
| lookmate.auth.registration-requests / registration-window | 10 / 1h |
| lookmate.auth.failed-attempts / failure-window / lock-duration | 5 / 15m / 15m |
| lookmate.auth.max-rate-entries | 10000 |

限流只放有界内存，重启清空；达到容量后拒绝新计数项，保留仍有效的限制。来源 IP 默认用连接地址，不信任客户端转发头。生产反向代理接入时需限定可信代理，否则限流会按代理 IP 共享；Nginx 部署尚未实现。

密码使用 Spring Security PBKDF2（v5.8 默认参数，带算法标识），支持完整的 64 码点密码。只把账号 ID 与登录时间放入会话认证信息，不保存密码哈希。账号有效性与绝对期限由服务端每次校验。MyBatis-Plus/MySQL/Spring Session Redis 已接入，AI 仍只有 BOM。

公开 `/actuator/health/liveness` 用于存活检查；`/actuator/health` 现在包含 MySQL、Redis 健康状态，依赖故障可能返回 503，不等于进程死亡。响应不暴露组件详情。

## 验证

`./mvnw verify` 运行不依赖外部服务的测试，跳过需要实际 MySQL 的 4 项启动、命名空间与故障集成检查。准备已迁移的隔离测试库和独立 Redis 命名空间，在权限受限的 properties 文件中配置连接，运行完整检查：

```sh
LOOKMATE_INTEGRATION=true SPRING_CONFIG_IMPORT=file:/绝对路径/测试配置.properties ./mvnw verify
```

测试不自动执行迁移。当前证据见 [开发验证](../../docs/testing/02-checks/2026-10-20-登录注册.md)。中间件版本统一为开发环境的 MySQL 8.0.45／Redis 7.4.11；生产 Compose 与 HTTPS 代理仍待部署阶段验证。
