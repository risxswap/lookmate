# Web 登录页微调实施计划

依据：[需求说明：Web 登录页微调](01-需求说明.md#2026-11-19-web-登录页微调)。2026-11-19 用户确认按草案实施。范围仅限 Web 登录呈现及微信取码底色；不改扫码确认、5 分钟有效期、旧码作废、会话、账号绑定、小程序页面、注册行为或 Lookmate API 契约。

## WEB-01：统一两种登录方式的布局和反馈

- [x] 修改 `apps/web/src/pages/AuthPage.tsx`、`AuthPage.css` 和 `apps/web/src/features/auth/WechatQrLogin.tsx`。保留品牌图、标题和两种登录方式；预留同一内容区，桌面切换和常态反馈不移动标题与标签，窄屏长文案可自然增高。注册页不套用登录布局。
- [x] 正常时显示无外框、无容器白底的小程序码，移除重复标题；码区右上角用带可访问名称、提示与合适点击面积的刷新图标，码下仅留「微信扫一扫，在小程序中确认登录」。不得用滤镜修改码图像素或裁掉码图留白。
- [x] 加载、取消、过期和失败状态原位显示，至多一个恢复操作。可继续查状态时保留现有码票据并优先查状态，不自动换码；不展示供应商或原始请求错误。账密错误在表单内显示、保留用户名，凭据错误统一提示，保留限流等待语义。继续使用 Ant Design 和现有轮询逻辑。
- [x] 在 `apps/web` 运行 `npm run build` 和 `node --test tests/*qr*.test.mjs`（使用已安装的 Node 24）。用真实浏览器及本地模拟接口检查桌面与窄屏、正常码、刷新、过期、取码失败、恢复状态、账密错误与面板位置。不连接真实账号。

## SERVER-01：由微信生成透明底小程序码

- [x] 修改 `apps/server/src/main/java/cc/riskswap/lookmate/integration/wechat/WechatClient.java`，在现有 `/wxa/getwxacodeunlimit` 请求加布尔值 `is_hyaline: true`；保留 `check_path`、`env_version`、场景、页面和原样返回图片的逻辑。前端已经接受 PNG 和 JPEG，无需改变 API 契约。
- [x] 更新 `apps/server/src/test/java/cc/riskswap/lookmate/integration/wechat/WechatClientTest.java`，以本地模拟微信接口断言参数，覆盖 PNG 与已有页面校验和 JPEG 兼容性。在 `apps/server` 使用 Java 21 运行 `./mvnw -o -Dtest=WechatClientTest test`。

两项可并行实施；透明码与页面可独立验证。实施后记录构建、测试和浏览器结果。正式环境实际返回的透明像素及真机可扫性需单独确认；本次不部署、不改配置或数据库、不重启既有服务。

## 实施状态

WEB-01 与 SERVER-01 已实现，通过构建、离线测试及使用模拟接口的浏览器检查。详见[临时验证记录](../../testing/02-checks/2026-11-19-Web登录页微调验证.md)。真实微信码和手机扫码未验证。
