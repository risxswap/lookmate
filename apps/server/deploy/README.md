# server 运行配置

本目录提供运行模板，Compose 位于上一级目录。部署机器通过固定 Java 21 JRE 镜像挂载 `releases/<版本>/lookmate-server.jar`，无需 Maven 或业务源码。默认镜像为 `eclipse-temurin:21.0.13_9-jre-jammy`，官方镜像包含健康检查使用的 curl；可改为同版本、已核对的镜像地址或 digest。

## 首次准备

将交付包中的 server 组件放到稳定目录，例如 `/opt/lookmate/server`，后续只增加 releases 中的新版本，不更换稳定目录。从该目录执行：

```sh
cp deploy/.env.example .env
sudo install -d -o 10001 -g 10001 -m 750 config runtime
sudo install -o 10001 -g 10001 -m 600 deploy/application.properties.example config/application.properties
chmod 600 .env
```

编辑 `.env` 的版本及绝对路径，并填写 `config/application.properties` 的数据库、Redis、微信与供应商配置。配置文件使用 Java properties 转义规则，不能复制 Compose `.env` 中字符串外围的单引号。修改容器 UID/GID 时同步调整实际配置及 runtime 的所有者。JAR 和父目录应允许该用户读取、访问，runtime 必须可写。

连接同机默认网络时，数据库和 Redis 地址分别为 `lookmate-mysql:3306`、`lookmate-redis:6379`；账号密码须与对应组件及迁移入口一致。镜像初始化不会替应用执行迁移。先创建共同外部网络并启动依赖、显式迁移到该版本要求的结构，再启动 server。当前程序要求 V11。

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail 100 server
```

Compose 不发布 server 的宿主机端口。容器内监听 `0.0.0.0:8080`，web 通过外部网络别名访问。网络名默认 `lookmate`，首次由部署者执行 `docker network create lookmate`；已存在时沿用，所有组件填写相同网络名。

## 配置与更新

Compose 只读挂载 JAR 和实际配置；不存在的源文件会直接报错，不自动创建同名目录。runtime 独立挂载到 `/app/runtime`，生成结果暂存固定为其 generation 子目录。容器重建、版本切换不能删除该目录；供应商凭据及 preview-secret 需要按旧任务恢复要求保留。默认容器内存上限1536m，可根据实际负载调整，不把它视为已验证容量。

更新时先按现行维护要求停止接收工作并等待已有任务结束，必要时显式迁移，再复制新版本到 releases，更新 `.env` 的 `LOOKMATE_VERSION`，执行 `docker compose up -d`。不要用交付模板覆盖实际配置。停止宽限为5分钟，应用生命周期每阶段上限240秒，这些参数不能替代完整维护协调；本次未增加自动排空或发布控制接口。程序回退前核对数据库兼容性，保留新表列和持久化暂存，不自动回滚数据库。

健康检查使用 `/actuator/health/liveness` 判断进程存活，避免外部服务故障直接导致存活检查失败；完整 `/actuator/health` 还检查 MySQL/Redis。容器 unhealthy 不会由本 Compose 自动重启，应结合日志处理。

生产保留 Secure Cookie。配置启用 Tomcat 原生转发头处理；受控网络中的 web 代理传入可信的协议、主机、端口与客户端地址，宿主机入口必须覆盖外部传来的转发头。共同 Docker 网络按受信任组件管理，不在公网暴露 server。

官方参考：[Temurin 镜像标签](https://github.com/docker-library/official-images/blob/master/library/eclipse-temurin)、[Temurin JRE Dockerfile](https://github.com/adoptium/containers/blob/main/21/jre/ubuntu/jammy/Dockerfile)、[Spring Boot 代理配置](https://docs.spring.io/spring-boot/how-to/webserver.html#howto.webserver.use-behind-a-proxy-server)。
