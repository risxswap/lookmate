---
name: java-backend
description: 开发、修复或审查 Java 后端接口、业务服务、持久化、事务、并发和后端测试，使用阿里 Java 规约的已映射子集，按需参考 Spring Boot 实践，适配项目实际版本、数据库和持久层。
---

# Java 后端开发

读取目标项目 `AGENTS.md`、pom.xml 或 Gradle 配置、实际 JDK 和框架版本、数据访问实现、迁移和测试。项目的 `AGENTS.md` 缺少架构或技术栈定义，或定义与实现冲突时，读取 [项目约定](../development-workflow/references/project-conventions.md)，先调查、再与用户确认，沿用当前任务模式。

直接承担开发任务时读取 [开发流程](../development-workflow/SKILL.md)，沿用已有阶段，无对应 Spec 的局部修改采用轻量流程；有对应 Spec 的实施遵循公共 [实施计划与子 agent 执行](../development-workflow/references/implementation-planning.md) 规则。被开发、诊断、审查或建模技能作为技术参考读取时，只提供当前所需规则，不回调工作流或重新确定任务模式。

进入任务时读取已有词汇表（如 `GLOSSARY.md`）、相关 Issue / Spec 和 ADR，沿用业务术语与已确定取舍；资料缺失不要求补齐整套文档。

## 规则与边界

编码或审查读取 [Java 规约](references/java-conventions.md)；首次应用阿里规则、解释等级或处理规则冲突时读取 [来源映射](references/alibaba-rule-mapping.md)。本套采纳部分规则，未映射的规则不宣称已经执行；补充实践不标成阿里强制。

用户明确决定和项目约定优先于本套通用建议；框架专属规则仅在使用该框架时适用。冲突时记录来源、影响与采用理由；权限和数据正确性问题必须指出。修复当前范围，既有风格差异不触发全仓重写。

后端框架、分层与部署形态由项目约定决定。服务发现、网关治理、服务间 RPC、分布式事务和微服务拆分不在本技能范围。缓存、消息队列和配置中心按真实需求选用，不是前置条件。

## 按任务读取

| 任务 | 参考 |
| --- | --- |
| 项目已选择 Spring Boot 单体，涉及模块边界、配置、依赖注入或异常出口 | [Spring Boot 单体](references/spring-boot-monolith.md) |
| 接口、输入校验、鉴权、文件、敏感数据 | [API 与安全](references/api-and-security.md) |
| 数据访问、事务、分页、迁移、并发写入 | [持久化与事务](references/persistence-and-transactions.md) |
| 异步、线程池、定时任务、第三方调用 | [并发与任务](references/concurrency-and-jobs.md) |
| 测试、构建和交付 | [后端验证](references/backend-verification.md) |

涉及前端消费者时读取公共 [契约协作](../development-workflow/references/api-contract-collaboration.md)。完成标准是受影响业务行为及失败路径有证据，接口说明同步，不以代码生成完成代替验证。
