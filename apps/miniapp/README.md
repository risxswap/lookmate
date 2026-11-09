# Lookmate 微信小程序

微信原生小程序，TypeScript 6.0.3 与 TDesign 微信小程序组件库 1.17.0。与现有 server 共用账号和业务接口，Web 开发方式保持不变。

## 本地构建

使用 Node.js 24 LTS，在本目录运行：

```sh
npm ci
npm run typecheck
npm test
npm run build
```

构建将 `src/` 编译到 `dist/`，并复制所用 TDesign 组件的依赖闭包，转换为微信可加载的 CommonJS 模块。无需额外执行微信开发者工具的“构建 npm”。`dist/`、`node_modules/` 不提交。`npm run check` 检查页面清单和组件文件引用，不能替代微信开发者工具编译或真机验收。

## 导入微信开发者工具

也可以在 VS Code 的“运行和调试”中选择“启动微信小程序”，按 F5。该启动项先执行 `npm run build`，成功后调用本机微信开发者工具 CLI 打开本应用目录。当前使用 macOS 默认安装路径 `/Applications/wechatwebdevtools.app`；工具安装在其他位置时，修改 `.vscode/launch.json` 中的 CLI 路径。

首次使用 CLI 前，在微信开发者工具“设置 → 安全设置”中开启服务端口。小程序断点及模拟器调试在微信开发者工具内进行；修改源码后重新执行启动项以更新 `dist/`。此启动项不自动启动后端或 frp。

1. 先完成本地构建，然后导入本应用目录；`project.config.json` 指向 `dist/`。
2. `project.config.json` 已配置项目 AppID，可直接导入。AppSecret 仅保存在服务端本地私有配置中，不写入小程序或提交到仓库。
3. `src/config.ts` 使用 `https://lookmate.labno3.com/api`。域名和真实微信接入尚待部署核验；本轮不进行实际联调。
4. 后续联调时需配置微信请求域名、七牛上传/下载域名、HTTPS 与平台所需权限。Vite/Web、云端 Nginx 和 frp 不由本应用脚本启动或改写。

每次修改代码后重新 `npm run build`，构建会检查所有已注册页面及组件引用。

## 页面与模块

底部导航为首页、设计、衣橱、我的；首次未登录显示登录流程，扫码页位于 `pages/scan/index`。登录页不提供游客模式，账户页不提供退出、解绑或换绑。

- `src/lib/request.ts`：响应包装、字符串 ID、单次会话恢复、禁止写操作自动重放。微信请求不支持 PATCH，统一转为受后端限制的 POST + `X-HTTP-Method-Override: PATCH`。
- `src/lib/auth.ts`、`session.ts`：微信登录及绑定、小程序 token 保存、自动恢复；账号变化时不把新账号响应写入旧页面。
- `src/lib/files.ts`：原图选择/上传/登记、私有文件地址、受鉴权的图库图片下载、保存到相册。图库接口图片先转换为临时本地路径，不在普通 image 标签中漏传认证。
- `src/lib/storage.ts`：按账号及设计模式隔离草稿和提交恢复数据。随机幂等键使用异步 `requestKey()`，调用处需等待。
- `src/lib/pagination.ts`：服务端分页累计加载、筛选/刷新竞态保护、失败保留已有页。
- `src/types/api.ts`：依据现有 Web/服务端提取的业务类型与纯资料工具。

账号昵称/头像与设计照片分开；照片、衣物再次提交前以服务端校验为准。登录恢复后不自动重放上传登记、提交设计或其他写操作。扫码确认始终是用户明确操作；扫码、登录或注册成功都不会自动确认网页登录。

## 验证边界

本轮只执行类型检查、离线模拟测试、构建/引用检查及本机wcc/wcsc原生模板离线编译。没有调用真实微信、七牛、生成供应商或共享数据库，没有扫码、真机、跨端或网络联调。完整需求和分期见仓库 `docs/02-需求文档/2026-10-30-微信小程序/`。
