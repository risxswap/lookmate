# 数据库迁移

已增加本地开发使用的 Flyway 12.4.0 Maven 入口，并在隔离测试库执行 V1。既有 lookmate 开发库未迁移，生产迁移仍待实施；生产一次性 Compose 服务尚未配置。

- [V1__initial_schema.sql](db/migrations/V1__initial_schema.sql)：17 张业务表、主键、唯一及查询索引和 7 个固定穿戴分类。
- 目标语法为 MySQL 8.0+，具体生产版本仍待锁定。字符集 utf8mb4，排序规则 utf8mb4_bin；应用负责用户名小写、收藏夹名称去首尾空白及 NFC 规范化。
- 每表包含自增 BIGINT 主键、created_at 和 updated_at；时间由应用显式写入 UTC。SQL 不设置自动更新时间，防止后台字段变动误代替业务版本控制。
- 不创建外键、维护门禁表、备份表或独立用户资料表。关联和跨账号校验仍由应用事务完成。
- 脚本不创建数据库、账号或权限，不包含 DROP/TRUNCATE，也不使用 IF NOT EXISTS 忽略已有表冲突。

后续由 ops 的 Flyway 对选定的空业务库显式执行。MySQL DDL 不视为可整体回滚的事务；若首次迁移中断，先核查实际表和迁移状态，不直接重复执行或删除既有数据。迁移一旦应用，不修改原脚本，变更使用后续版本。

model_call 现为 15 个调用记录字段；任务使用 current_call_id 和原有 attempt_token 校验写回。design_task 另有 result_url_ciphertext 保存外部结果下载地址密文；图片文件的定位、大小、摘要及固定存储目标由持久化清单管理。结果保存复用任务状态、next_check_at 和错误字段。数据库、文件与外部调用之间的恢复一致性尚需业务实现和验证。

设计来源：[数据库设计](../docs/01-项目总览/04-数据库设计.md)。解析器检查不等于 MySQL 执行验证；尚未在 MySQL 中验证约束、索引或并发行为。

不建立 CONSTRAINT CHECK。状态枚举、尺寸正值、版本与计数非负、名称非空、季节位掩码、文件就绪元信息及任务图片用途／位置校验均由代码负责。保留主键、唯一索引、查询索引和字段 NOT NULL 定义；本次只修改尚未执行的初始化脚本，未修改实际数据库。

衣橱多图调整：dress 只存单品资料和图片集合版本；dress_image 存多张图片、顺序、图片级 AI 字段与人工覆盖；dress_recognition 存整组识别输入快照、执行状态、历史结果及引用保留标记。model_call 关联 DESIGN_TASK 或 DRESS_RECOGNITION，不直接关联单品。design_task_asset 保留单品与图片来源编号快照。当前 17 张表，直接更新尚未执行的 V1，未连接数据库。至少一张图、封面顺序、快照文件保留、过期执行权和人工优先均由代码保证，SQL 解析不能代替业务验证。

固定方案栏目已同步：design_result 移除 plan_json，以 summary 替代 explanation，并增加标题、风格、场景、设计理由、配色及整体穿着建议；新增 design_result_item 和 design_result_hairstyle。plan_provenance 仅保留模型来源元信息。方案类型与明细匹配、正文非空、保存／复制／删除明细的事务一致性由代码维护，不增加 CHECK 或外键。

model_call 简化已同步 SQL，删除完整提示词、请求响应元信息、调用序号及暂存保存字段；不新增表，仍为 17 张。任务配置快照、正式方案和识别结果负责各自追溯数据。当前 V1 尚未执行，因此直接更新；已应用的环境必须另写升级迁移，不覆盖旧版本。

## 本地显式迁移

迁移与后端共用项目外的 `~/.config/lookmate/.env.dev`，读取 `spring.datasource.url`、`spring.datasource.username` 和 `spring.datasource.password`，无需单独维护 Flyway 配置。文件为 Java properties 格式，权限设为 600。脚本使用 Java 21 读取配置，再通过子进程环境传给 Flyway，凭据不放入命令行参数。账号需具备执行迁移 SQL 的权限；应用启动仍不自动迁移。

```sh
bash ops/migrate.sh info
bash ops/migrate.sh migrate
bash ops/migrate.sh validate
```

从项目根目录调用。脚本要求 Java 21；macOS 上当前 Java 版本不匹配时，自动选择已安装的 Java 21，并同步设置子进程的 JAVA_HOME。其他环境需预先配置 Java 21。可通过 `LOOKMATE_DEV_CONFIG=/绝对路径/.env.dev` 指定另一份共享配置。脚本只开放 info、validate、migrate，禁用 clean，不自动建库或 baseline。生产仍按架构中的独立 Compose 迁移方案实施，本地 Maven 入口仅用于开发验证。Flyway/MySQL 驱动固定为 12.4.0/9.7.0，与当前 Boot 管理版本一致。

2026-10-20：V1 在本轮专用隔离库执行成功，实际数据库版本为 MySQL 8.0.45。数据库版本已统一为 MySQL 8.0.45；此证据不代表生产迁移已验证。历史章节中的“未执行”描述生成时状态；当前验证见 [登录注册开发验证](../docs/testing/02-checks/2026-10-20-登录注册.md)。
