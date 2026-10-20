# 持久化与事务

A12、A14、A16 的来源见 [规则映射](alibaba-rule-mapping.md)。其余为本套补充，先核实数据库、驱动、ORM、Spring 版本和实际配置。

## 查询与写入

参数绑定用于值；动态列名、表名和排序方向必须由服务端允许列表映射。MyBatis 使用 #{...} 绑定值，${...} 是直接替换，不能放入未经限定的输入。参见 [MyBatis 参数与字符串替换](https://mybatis.org/mybatis-3/sqlmap-xml.html)。MyBatis-Plus 复用项目现有 wrapper 和分页配置，检查最终 SQL；JPA 检查抓取计划、分页和实际 SQL，避免逐行关联查询及接口序列化触发额外查询。

分页提供稳定排序及最大页大小；深分页按访问需求优化，不自动引入游标协议。批量写入控制批次与事务规模。根据真实查询和数据量看执行计划，索引语法和类型限制只应用到对应数据库。

业务唯一性用数据库约束兜底，不能依赖先查再插。版本条件更新、原子条件更新或数据库锁按竞争场景选择，检查影响行数并映射冲突结果。单体多实例不能依赖 synchronized 保证跨实例一致性。

## 事务

将需要原子完成的数据库操作放在明确业务边界内，核实数据源和事务管理器一致。使用 Spring 声明式事务且采用默认代理模式时，自调用不经过事务代理；检查入口是否实际经过代理，而非只检查 @Transactional 注解。参见 [Spring 事务代理说明](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)。

Spring 声明式事务的默认回滚通常针对 RuntimeException/Error；受检异常和项目全局设置需另外核实。针对业务失败明确 rollbackFor 或等效配置。catch 后返回成功会隐藏应回滚失败，应传播或显式标记回滚。参见 [Spring 回滚规则](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html)。链接是滚动文档，实施时切换到项目对应版本。

外部 HTTP、文件和邮件不受本地数据库回滚保护。缩短持锁时间，明确失败补偿或提交后动作；只有可靠投递属于业务要求时才设计持久化重试，不默认引入分布式事务。

## 迁移与验证

沿用现有迁移工具，检查存量 null、重复值及数据规模，再添加约束或改变类型。迁移在隔离环境验证，说明兼容窗口和恢复方案；不能默认在生产执行。

多步写入测试注入中间失败，在调用结束后通过独立读取确认全部相关记录回滚，避免测试方法自己的自动回滚掩盖服务事务缺陷。并发测试断言最终业务不变量，而不是只断言请求没有异常。
