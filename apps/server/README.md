# 用户服务端

Java 21 + Spring Boot 单 Maven 工程，根包 `cc.riskswap.lookmate`。已实现登录注册、Redis 会话、内存限流、统一错误响应、数据库结构检查和工作台只读查询；设计记录、收藏与收藏夹已实现，衣橱与私有文件接口也已实现，生成尚未实施。

工作台提供 `GET /api/workspace` 和 `GET /api/designs/{id}`，按当前账号读取未隐藏任务及已保存方案文字。接口与图片依赖边界见 [工作台需求](../../docs/02-需求文档/2026-10-20-工作台/01-需求说明.md)，开发证据见 [验证记录](../../docs/testing/02-checks/2026-10-20-工作台.md)。

## 本地启动

使用 Java 21，将 JAVA_HOME 指向对应安装目录。在 `apps/server/` 运行：

```sh
./mvnw verify
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

应用现在需要可用的 MySQL、Redis 和完成 V1、V2 迁移的数据库。启动只读检查迁移历史与认证、基础属性及偏好所需字段，不自动迁移或建库。通过根目录 [ops](../../ops/README.md) 显式迁移；隔离验证后，已于 2026-10-21 按用户授权迁移共享开发 lookmate 库至 V2，并重启开发后端。

`dev` profile 默认加载项目外的 `~/.config/lookmate/.env.dev`，同一用户的多个工作目录共享该配置，不依赖启动目录。文件为 Java properties 格式，不可通过 shell source；也可用 `LOOKMATE_DEV_CONFIG` 指定其他配置文件的绝对路径。首次配置时创建 `~/.config/lookmate/`，将仓库中的 `.env.dev.example` 复制为该目录下的 `.env.dev`，填写连接信息并将权限设为 600。VS Code、Maven 和 JAR 在 dev 模式下均使用这一规则。

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

密码使用 Spring Security PBKDF2（v5.8 默认参数，带算法标识），支持完整的 64 码点密码。只把账号 ID 与登录时间放入会话认证信息，不保存密码哈希。账号有效性与绝对期限由服务端每次校验。MyBatis-Plus/MySQL/Spring Session Redis 已接入，Spring AI 仍只引入 BOM；衣物视觉识别使用独立 HTTP 适配，详见下文。

公开 `/actuator/health/liveness` 用于存活检查；`/actuator/health` 现在包含 MySQL、Redis 健康状态，依赖故障可能返回 503，不等于进程死亡。响应不暴露组件详情。

## Java 格式检查

生产代码和测试代码统一使用 Spotless 3.0.0 + google-java-format 1.28.0 的 AOSP 风格（四空格缩进），配置在 `pom.xml`。声明注解独占一行，非空方法体展开，成员方法之间留空行。Spotless 在 google-java-format 后补充声明注解换行规则，避免字段注解被重新合并；字段逐项声明仍需在 diff 审阅时核对。交付前还需审阅 diff，确认逻辑分段便于阅读。

在 `apps/server/`、Java 21 环境执行：

```sh
./mvnw spotless:check
./mvnw spotless:apply '-DspotlessFiles=.*/src/main/java/cc/riskswap/lookmate/controller/ProfileController\.java'
./mvnw verify
```

第二条是单文件修复示例，`spotlessFiles` 按绝对路径匹配正则表达式，保留 `.*/` 前缀并替换实际文件路径；全模块统一格式时才使用不带 `spotlessFiles` 的 `spotless:apply`。检查绑定 Maven `validate` 阶段，因此 `test`、`package`、`verify` 和根目录打包脚本都会先检查格式，失败即停止且不改写源码。检查范围只包含 Java 源码，不含生成目录 `target/`。

本次接入与回归证据见 [Java 格式检查记录](../../docs/testing/02-checks/2026-10-21-Java格式检查.md)。

## 验证

`./mvnw verify` 运行不依赖外部服务的测试，跳过需要实际 MySQL 的 4 项启动、命名空间与故障集成检查。准备已迁移的隔离测试库和独立 Redis 命名空间，在权限受限的 properties 文件中配置连接，运行完整检查：

```sh
LOOKMATE_INTEGRATION=true SPRING_CONFIG_IMPORT=file:/绝对路径/测试配置.properties ./mvnw verify
```

测试不自动执行迁移。当前证据见 [开发验证](../../docs/testing/02-checks/2026-10-20-登录注册.md)。中间件版本统一为开发环境的 MySQL 8.0.45／Redis 7.4.11；生产 Compose 与 HTTPS 代理仍待部署阶段验证。

设计记录接口与事务规则见 [设计记录需求](../../docs/02-需求文档/2026-10-20-设计记录/01-需求说明.md)，验证覆盖真实数据库并发和回滚。

## 我的衣橱与私有文件

已实现衣橱分类、单品 CRUD、多图排序、逐图人工特征及版本冲突、识别任务和重试。接口见 [衣橱契约](../../docs/02-需求文档/2026-10-20-我的衣橱/01-需求说明.md)，验证见 [开发记录](../../docs/testing/02-checks/2026-10-20-我的衣橱.md)。无需新增迁移，沿用 V1 表结构。

将 [可选配置示例](integrations.example.properties) 中需要的项加入项目外 `LOOKMATE_DEV_CONFIG` 指定的 properties 文件，不提交密钥。七牛需配置私有 bucket、上传 URL 和私有下载域名及密钥；DeepSeek 需配置密钥、已确认支持视觉的模型标识，并开启 recognition.enabled。默认未启用识别，未填写模型标识。未配置时上传返回明确的 503，保存已有可用图片的单品仍成功，识别记录为 FAILED，可人工补齐。

文件核验和衣物识别使用独立有界执行器，任务状态写 MySQL；Redis 仍只保存会话。`lookmate.jobs.enabled=false` 可停止后台调度，用于隔离测试；`lookmate.assets.maintenance` 是本进程操作开关，不代表完整的持久化维护协议。示例容量、超时和并发值是开发初始值，尚未经过真实供应商验证。当前支持单个 server 进程。

真实七牛和 DeepSeek 尚未配置或联调；隔离测试使用存储与模型替身，不能替代供应商验收。规划模型与识别共享额度的公平调度须在设计执行器实施时接入。

个人资料已实现显示名称、27 项尺寸历史、照片库与默认照片管理，并完成开发验证；真实七牛链路仍待配置联调。见 [个人资料需求](../../docs/02-需求文档/2026-10-21-个人资料/01-需求说明.md) 和 [验证记录](../../docs/testing/02-checks/2026-10-21-个人资料.md)。


个人属性扩展已实现：user性别/生日、user_preference及偏好PATCH、尺寸提交必填gender并原子更新用户资料。启动新版前通过ops执行V2，旧尺寸请求缺gender返回400，前后端配套更新。隔离环境验证见 [本轮记录](../../docs/testing/02-checks/2026-10-21-个人属性与尺寸交互.md)，共享开发库随后已按用户授权执行 V2；生产未迁移。
