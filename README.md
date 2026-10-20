# Lookmate

面向个人的发型与穿搭设计工具，首版由 AI 生成本人效果图和设计说明，面向桌面浏览器。

用户服务端 `apps/server/` 与用户 Web `apps/web/` 已实现登录注册、会话恢复、退出和请求限制。其他业务模块待逐模块讨论与实施，运营两端暂缓。初始化 SQL 已通过 Flyway 在隔离测试库执行，既有开发库未迁移，生产尚未部署。

## 本地开发

后端需要已迁移的 MySQL 数据库与 Redis，配置与迁移步骤见服务端和 ops 说明。准备 Java 21 和 Node.js 24（版本见 `apps/web/.nvmrc`）。后端使用项目内 Maven Wrapper，前端使用 npm 锁文件。

```sh
cd apps/server
./mvnw verify
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

在另一个终端从项目根目录启动前端：

```sh
cd apps/web
npm ci
npm run dev
```

前端地址为 http://127.0.0.1:5173 ，后端健康检查为 http://127.0.0.1:8080/actuator/health 。如本机默认 Java 不是 21，先设置 JAVA_HOME。

从项目根目录执行 `./tools/package.sh all` 可验证并构建两端；仅构建一端时使用 `server` 或 `web` 参数。脚本不执行迁移或部署。

- [服务端说明](apps/server/README.md)：启动、安全默认行为和接入边界。
- [Web 说明](apps/web/README.md)：环境、开发代理和构建。
- [框架搭建记录](docs/02-需求文档/2026-10-20-项目框架搭建/01-需求说明.md)：本轮范围与验证证据。
- [文档导航](docs/README.md)：总览、需求与技术决策入口。
- [功能总览](docs/01-项目总览/01-功能总览.md)：实际实现与验证状态。
- [首版需求](docs/02-需求文档/2026-10-20-首版个人形象设计/01-需求说明.md)：业务范围与验收条件。
- [项目协作约定](AGENTS.md)：开发流程与已确认边界。
