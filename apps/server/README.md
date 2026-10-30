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

`dev` profile 默认加载 `../../.env.dev`；从 `apps/server/` 启动时，读取项目根目录的 `.env.dev`。文件为 Java properties 格式，不可通过 shell source；也可用 `LOOKMATE_DEV_CONFIG` 指定其他配置文件的绝对路径。首次配置可参考 [接入配置示例](integrations.example.properties) 和 `application.yml`，填写数据库、Redis 及所需供应商连接信息，将私有配置权限设为 600。识别、生成和后台调度默认运行，供应商配置完整后即可处理任务。VS Code 后端与数据迁移均指向 `.env.dev`；Maven 和 JAR 从 `apps/server/` 启动，其他启动目录须用 `LOOKMATE_DEV_CONFIG` 指定绝对路径。该私有文件已被 Git 忽略。

默认监听 `127.0.0.1:8080`。打包后运行：

```sh
java -jar target/lookmate-server.jar --spring.profiles.active=dev
```

运行中的 JAR 不应被构建覆盖；重新构建前停进程，或将产物复制到独立运行目录。

## 认证与配置

接口和失败行为见 [登录注册需求](../../docs/02-需求文档/2026-10-20-登录注册/01-需求说明.md)。注册默认开放，Cookie 为 Secure、HttpOnly、SameSite=Lax；dev 关闭 Secure 以支持本地 HTTP。未启用默认账号、表单登录或 HTTP Basic，所有写接口保留 CSRF。

| 配置 | 默认值 |
| --- | --- |
| spring.session.timeout | 2h |
| spring.session.data.redis.namespace | lookmate:server:sessions |
| lookmate.auth.absolute-timeout | 7d |
| lookmate.auth.remember-me-timeout | 30d（须为 1～2147483647 的整数秒） |
| lookmate.auth.login-requests / login-window | 30 / 1m |
| lookmate.auth.registration-requests / registration-window | 10 / 1h |
| lookmate.auth.failed-attempts / failure-window / lock-duration | 5 / 15m / 15m |
| lookmate.auth.max-rate-entries | 10000 |

限流只放有界内存，重启清空；达到容量后拒绝新计数项，保留仍有效的限制。来源 IP 默认用连接地址，不信任客户端转发头。生产反向代理接入时需限定可信代理，否则限流会按代理 IP 共享；Nginx 部署尚未实现。

记住登录使用当前 Redis 会话与持久 Cookie，普通登录仍为会话 Cookie。remember-me-timeout 同时决定记住会话绝对期限和首次 TTL；之后 TTL 与 Cookie 写出期限按剩余时间计算，不随访问延长。Cookie 名称、域、路径及安全属性沿用 server.servlet.session.cookie；max-age 不作为全局期限使用。登录失败不创建记住身份，成功登录重建会话，退出与密码变更沿用原失效规则。配置变化重启生效，页面从 /api/auth/config 获取实际期限。

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

已有开发配置缺项时，可从 [接入配置示例](integrations.example.properties) 按缺失项补充到 `.env.dev` 或 `LOOKMATE_DEV_CONFIG` 指定的 properties 文件，保留原有值；示例文件本身不会自动加载，不提交密钥。七牛需配置私有 bucket、上传 URL 和私有下载域名及密钥；识别需配置密钥、核实所选模型的视觉能力。默认供应商为硅基流动、模型为 `deepseek-ai/DeepSeek-V4.1-Flash`。未配置时上传返回明确的 503，保存已有可用图片的单品仍成功，识别记录为 FAILED，可人工补齐。

文件核验和衣物识别使用独立有界执行器，任务状态写 MySQL；Redis 仍只保存会话。后台调度随应用启动；隔离测试通过 MockitoBean 替换调度器；`lookmate.assets.maintenance` 是本进程操作开关，不代表完整的持久化维护协议。示例容量、超时和并发值是开发初始值，尚未经过真实供应商验证。当前支持单个 server 进程。

真实七牛与模型服务尚未完成联调；隔离测试使用存储与模型替身，不能替代供应商验收。规划与识别现已接入共享额度与公平调度，见下方设计生成说明。

个人资料已实现显示名称、27 项尺寸历史、照片库与默认照片管理，并完成开发验证；真实七牛链路仍待配置联调。见 [个人资料需求](../../docs/02-需求文档/2026-10-21-个人资料/01-需求说明.md) 和 [验证记录](../../docs/testing/02-checks/2026-10-21-个人资料.md)。

个人属性扩展已实现：user性别/生日、user_preference及偏好PATCH、尺寸提交必填gender并原子更新用户资料。启动新版前通过ops执行V2，旧尺寸请求缺gender返回400，前后端配套更新。隔离环境验证见 [本轮记录](../../docs/testing/02-checks/2026-10-21-个人属性与尺寸交互.md)，共享开发库随后已按用户授权执行 V2；生产未迁移。

## 设计生成

生成接口与后台任务使用 V3 迁移。先通过 `ops/` 对目标环境显式执行迁移，再发布配套前后端；应用启动只检查版本，不自动执行 SQL。

生成默认运行。接入真实供应商前，核实规划图片协议与生图多图编辑协议，设置模型、端点、密钥、生成参数，实测图片张数、总字节及文字预算。参数模板见 `integrations.example.properties`；未配置时接口返回 `GENERATION_UNAVAILABLE`。预览签名密钥至少 32 字符，使用项目外受控配置。

任务保留非敏感模型配置快照。旧模型凭据可通过 `plan-credentials` / `image-credentials` 的 Map 提供，键为原始 `endpoint|model`；YAML 使用方括号包裹完整键以保留标点。当前端点和模型同时一致时才使用当前密钥，避免同名模型跨端点误配。

`staging-directory` 必须挂载持久目录，独立于发布版本；返回图片先可靠落盘，再恢复上传和入库。保存失败只恢复保存，不重新生图。没有可靠暂存且无法确认的外部调用进入 `UNKNOWN`，停止自动重发；当前配置渠道未提供结果查询协议，因此不能自动找回该类远端结果。`FULL` 和 `IMAGE_ONLY` 是用户手动创建的新任务，`UNKNOWN` 不允许重试。

开发初值包括活动生成并发 2、保存独立并发 1、候选目标 24、近期窗口 10、衣橱扫描容量 500；均需按真实规模验证。规划与衣物识别共享供应商限额，规划优先并保留识别执行机会。真实供应商与七牛链路尚待联调；可控供应商测试不等同于真实质量验证。

## 模型供应商配置（2026-10-30）

识别配置前缀为 `lookmate.recognition`，设置 `provider`、`protocol`、`endpoint`、`model`、`api-key`；规划与生图配置前缀为 `lookmate.generation`，分别设置 `plan-provider/protocol/endpoint/model/api-key` 和 `image-provider/protocol/endpoint/model/api-key`。`provider` 用于调用记录，`protocol` 决定实际请求格式；只改供应商名称不会切换协议。修改项目外配置后重启服务。识别和规划默认使用硅基流动 `/v1/chat/completions`、`deepseek-ai/DeepSeek-V4.1-Flash`；生图默认使用 OpenAI `https://api.openai.com/v1/images/edits`、`openai-edits` 和 `gpt-image-2`；项目外配置可覆盖接入渠道，当前开发渠道继续沿用原配置。密钥留空，保留凭据、协议和数值预算校验，无需额外开启功能开关。

支持的协议：识别、规划使用 `openai-chat`；生图使用 `siliconflow-images`（JSON，响应 `images`）或 `openai-edits`（multipart，响应 `data`）。切换生图协议时同步替换 `image-parameters`，不要沿用另一个协议的参数。未知协议、空密钥或无效端点拒绝调用。端点须为 HTTPS；仅本机可控测试允许 HTTP 回环地址。

生图使用 GPT Image 2，不使用或自动回退到 Kolors。多图请求必须保留本人及选中衣物图，不能为满足单图协议删图；配置错误或供应商失败明确报错。应用侧图片预算不代表渠道实际容量，多图、尺寸、价格与效果需单独联调。

设计输入快照及安全摘要统一为 schemaVersion=3，规划输出统一为 schemaVersion=2。所有任务明确保存 fixedOutfit 和 outfitInspirationReference，无穿搭参考时后者为 null；READY 方案的 inspirationAdaptation 无参考时为 null。前后端与测试数据使用最新结构，不读取旧任务结构或自动补齐旧协议字段。

生成任务快照保存协议、供应商、模型、端点和预算，不保存密钥。已接受任务继续使用自身配置，凭据按保存的 endpoint|model 查找，不会向不同端点复用密钥；更换配置不自动修改已接受任务。识别沿用单配置策略：配置快照不匹配的排队任务明确失败，用户可在新配置下重试。

验证范围见 [模型供应商配置](../../docs/02-需求文档/2026-10-22-模型供应商配置/01-需求说明.md)。未修改本机真实密钥文件，未调用付费服务或执行数据库迁移。

### 衣物识别日志

服务端以 INFO 输出识别任务开始、模型调用、HTTP 响应及处理完成日志，记录 recognitionId、dressId、callId、模型、图片数量和耗时；失败以 WARN 输出状态、错误码或异常类型，执行层异常使用 ERROR。旧任务或图片版本已变化时记录跳过调用或跳过当前图片写入，不输出空轮询日志。日志不记录密钥、图片地址、输入快照或模型原始输出；异常只记录类型，避免异常消息泄露签名地址。重启后端加载新代码后，在启动终端搜索“衣物识别”即可查看。

生成默认限制：规划最多 10 张图片、生图最多 10 张图片、输入图片总计 20 MiB、规划文本 20000 个 Unicode 码点。这些是应用侧开发初值，不代表供应商已验证容量，接入后按实测调整。

## 形象设计日志（2026-10-27）

生成链路使用 `cc.riskswap.lookmate.common.util.GenerationLog` 输出诊断日志，默认 INFO 可见，沿用 Spring Boot 控制台输出，无需开启 HTTP 请求正文日志。预览、提交与重试记录 `requestId`；入队后可按 `taskId` 串起后台处理。`task_queued`、`submission_replayed` 与终态记录在事务提交后输出，回滚不误报成功。

主要事件包括 `preview_ready`、`task_claimed`、`plan_slot_wait`、`plan_validated`、`image_started`、`image_received`、`image_staged`、`storage_save_completed`、`task_finished`。保存恢复记录 `save_resumed` / `save_deferred` / `save_recovery_queued`，失去执行权记录 `task_ownership_lost`。`execution_released` 仅表示本次执行结束，不代表任务成功；以 `task_finished` 的状态为准。空轮询和正常租约续期不输出 INFO。

网关记录模型、协议、图片数、请求及响应字节数、HTTP 状态与耗时。`http_response` 表示已收到 HTTP 响应，仍需后续解析和校验通过；失败记录稳定错误码、异常类型及结果是否不确定，传输异常另记录根异常类型。日志不包含密钥、完整请求或响应、提示词、私人图片 URL、图片内容及异常原文。

排查时先用前端响应中的 `requestId` 找到提交记录，再按任务 ID 检索 `generation taskId=123 `。如已有重定向的日志文件，可执行 `rg 'generation taskId=123 ' <日志文件>`；该示例路径由实际运行方式决定。修改后须重启后端才能使用新增日志。

本轮使用本机可控 HTTP 供应商及日志捕获测试，验证 503 失败不重发、日志脱敏、事务提交/回滚、请求与任务关联、线程上下文恢复、领取失败和执行权丢失；未调用真实模型或写共享数据库。验证命令与结果见[生成实施计划 T4](../../docs/02-需求文档/2026-10-20-首版个人形象设计/04-生成实施计划.md#t4形象设计详细日志2026-10-27)。

## 微信小程序认证（2026-10-30）

代码新增微信登录、旧账号绑定、30天小程序会话、Web扫码及独立账号头像。启动结构检查要求 V11；迁移脚本仅生成，本轮未执行数据库迁移或真实微信/小程序联调。请勿在未应用 V11 的共享库直接启动本版本。

服务端配置 `LOOKMATE_WECHAT_APP_ID`、`LOOKMATE_WECHAT_APP_SECRET`，环境版本默认 `develop`、扫码页面默认 `pages/scan/index`；配置缺失返回 `WECHAT_UNAVAILABLE`，没有假登录回退。生产/体验版本按实际微信权限配置。密钥不得放入小程序或 Web；短期凭据不得写入日志。

小程序使用 `X-Miniapp-Token`；已有 Web 保留 Cookie 与 CSRF。原生小程序的 PATCH 通过 POST + `X-HTTP-Method-Override: PATCH` 适配，只在小程序凭证验证通过后生效。接口、扫码状态及数据影响见[实施契约](../../docs/02-需求文档/2026-10-30-微信小程序/04-接口与数据设计.md)。本次不调整现有 Web/Vite、云端 Nginx 或 frp。
