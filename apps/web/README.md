# 用户 Web

面向桌面浏览器的 React 单页应用。已提供公开首页、注册页 `/register`、登录页 `/login` 和受登录保护的工作台 `/app`。其他业务功能仍为入口占位。

## 本地启动

使用 `.nvmrc` 指定的 Node.js 24。使用 nvm 时先运行 `nvm install && nvm use`，然后执行：

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。`/api` 由 Vite 转发至 `http://127.0.0.1:8080`；可复制 `.env.example` 为 `.env.local` 修改 `API_PROXY_TARGET`。代理保留 `/api` 前缀，仅用于开发。

```sh
npm run typecheck
npm run build
npm run preview
```

产物位于 `dist/`。preview 只用于预览静态产物，不提供生产 API 代理；正式部署的 Nginx 配置后续补齐。

## 组织约定

`app/` 管理应用入口与 Provider，`pages/` 组合页面，`styles/` 管理样式。`features/auth/` 保存认证查询及安全跳转逻辑，`api/` 提供 JSON/CSRF 客户端。

查询与修改默认关闭自动重试，后续按具体接口明确重试策略；设计提交始终禁止自动重试。认证查询由 TanStack Query 管理，退出或会话过期时取消查询并清空缓存。Cookie 由浏览器管理，不在 localStorage 保存认证凭据。

依赖使用精确版本和 package-lock.json，复现构建使用 `npm ci`。浏览器环境变量不能包含密钥。当前构建仍有单包超过 500 kB 的提示，后续业务页面扩展时按路由拆包。

登录注册行为与开发验证见 [模块需求](../../docs/02-需求文档/2026-10-20-登录注册/01-需求说明.md)。生产需由 Nginx 将页面路径回退至 index.html，并代理同源 /api；目前只验证 Vite 开发代理。
