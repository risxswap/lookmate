# Lookmate 交付说明

版本、目标、UTC 构建时间、Git 提交和工作区状态见 `BUILD-INFO.properties`。`all` 目标生成 server、web、MySQL、Redis、frp 和 ops，`server` 目标生成 server 和配套 ops，`web` 目标生成 web，`infra` 目标生成 MySQL/Redis 部署配置及 frp 调试配置。其他依赖组件按需另行准备。

本包使用已有运行时镜像挂载 JAR、静态文件和配置，不构建应用镜像。部署服务器需要 Docker Engine 和 Compose 插件，并能拉取模板中的固定版本镜像。Flyway 12.4.0 官方镜像仅提供 linux/amd64；其他平台的准备要求见 `ops/deploy/README.md`。

## 校验与安装位置

打包默认直接在 `output/` 下生成组件目录。进入交付根目录核对文件校验值。

```sh
sha256sum -c SHA256SUMS
# macOS 也可使用 shasum -a 256 -c 替代 sha256sum -c。
```

`gitWorktree=dirty` 表示构建时工作区存在未提交修改。参数与工具链检查通过后，脚本持有输出目录锁，在构建前自动清理六个组件目录以及根目录的 `README.md`、`BUILD-INFO.properties`、`SHA256SUMS`，再生成本次选定目标。旧格式的 `lookmate-<版本>-<目标>` 目录、压缩包及外部校验文件也会清理，包括原 `packages/` 中的同类产物。输出目录中的其他素材与验证文件保留。`--output` 使用相同清理规则。清理后若构建失败，需修复问题并重新打包。

将组件安装到固定目录，例如：

```text
/opt/lookmate/
├── server/       # Compose、deploy模板、releases/<版本>/、实际config/和runtime/
├── web/          # Compose、deploy模板、releases/<版本>/和实际config/templates/
├── mysql/        # 独立Compose、配置及实际data/
├── redis/        # 独立Compose、配置及实际data/
├── frp/          # frps Compose、启动脚本、frpc/frps配置模板与说明
└── ops/          # 独立迁移Compose、SQL、驱动和实际.env
```

首次安装可将包中存在的组件目录复制到相应稳定目录；后续只更新需要发布的组件。实际 `.env`、应用配置、数据、日志和生成暂存均由目标机器维护，本包不包含这些文件。不要把 data/runtime 放入 `releases/<版本>/`，也不要每次升级更换整个安装根目录。

## 首次部署

1. 创建共同外部网络：`docker network inspect lookmate >/dev/null 2>&1 || docker network create lookmate`。如修改网络名，所有组件使用相同 `LOOKMATE_NETWORK`。
2. 按 `mysql/README.md` 和 `redis/README.md` 复制环境模板，填入不同的 MySQL root/业务密码与 Redis 密码，预创建独立数据目录，分别执行 Compose 配置检查、pull 和 up。等待各组件 healthy 后继续。
3. 按 `ops/deploy/README.md` 配置已存在的迁移账号，先执行 `bash migrate-compose.sh info` 核对目标，再显式执行 migrate 和 validate。应用不自动迁移；包内驱动与 SQL 随同 server 版本交付。
4. 按 `server/deploy/README.md` 准备只读外部应用配置和可写 runtime，填写数据库、Redis、微信及供应商参数。模板中的 LOOKMATE_VERSION 已设为本次构建版本，执行本组件 Compose 检查、pull 和 up。
5. 按 `web/deploy/README.md` 准备 Nginx 实际模板目录，执行独立 Compose 检查、pull 和 up。HTTP 默认只映射至宿主机 `127.0.0.1:18081`。
6. 将 `web/deploy/host-nginx.conf.example` 合并到宿主机已有 HTTPS 站点，沿用原域名、证书和 TLS 配置，检查 `nginx -t` 成功后按原方式 reload，再从 HTTPS 域名验证页面、登录、Cookie 和 API。

各步骤在对应组件稳定目录执行，不使用合并全部组件的总 Compose。server、MySQL、Redis 不发布宿主机端口，通过共同 Docker 网络连接；web 的容器 Nginx 提供静态资源并将 `/api` 转给 server。已有宿主机 Nginx 覆盖外部转发头，应用信任范围按各组件说明配置。

只部署单组件包时，沿用已安装且兼容的其他组件，不按完整首次部署流程重复初始化。`infra` 包不会编译应用，也不包含 SQL/迁移驱动；需要迁移时使用配套 `server` 或 `all` 包。

## frp 调试通道

`infra` 和 `all` 附带 `frp/`，其中包含固定版本 frps Compose、启动脚本、环境模板和 frpc/frps 配置。将该目录安装到 `/opt/lookmate/frp`，按 `frp/README.md` 的独立交付步骤填写两端配置，再在公网机启动 frps、本机启动 frpc。frp 为小程序访问本地后端提供调试通道。

## 更新与回退

保留现有 `.env`、实际 config、data 和 runtime，只将新版本 JAR/静态目录添加到对应 `releases/<版本>/`。Compose、交付模板或 SQL 有变化时，核对后同步相应文件；不要用示例覆盖实际配置。修改各应用 `.env` 的 `LOOKMATE_VERSION` 后，只重建需要更新的应用容器，应用更新不重启 MySQL/Redis。

发布前停止接收新工作并等待已有任务结束，需要结构升级时先显式迁移。当前交付没有自动维护排空、deploy.sh 或滚动发布能力，不要把停止宽限当成已完成任务排空。迁移失败时不启动不兼容的新应用，核对实际结构及 Flyway 状态，不自动 clean、baseline、repair 或重试失败 DDL。

回退应用可选择仍保留的旧版本产物，但必须先核对数据库和任务快照兼容性；切换程序版本不会撤销数据库迁移。容器重建和版本切换保留生成结果暂存及其需要的旧供应商凭据，不删除运行数据。

打包和配置解析不代表目标环境部署已验证。实际容器运行、数据重启保留、HTTPS 登录、微信与供应商效果需按本次允许的验证范围另行核对。
