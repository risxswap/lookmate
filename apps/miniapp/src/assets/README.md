# 小程序本地视觉资源

`editorial.jpg` 来自项目已有的 `apps/web/public/images/auth-editorial.webp`，等比例缩小并转换为JPEG，用于品牌展示及明确的空状态。

`icons/` 中的PNG由Lucide Static 0.468.0官方字体渲染，统一线宽。原生导航使用81×81透明图片，其他操作图标使用96×96透明图片。默认导航颜色为 `#666f65`，选中及操作图标颜色为 `#304f40`，浅色箭头为 `#fffefa`。构建直接复制PNG，页面通过本地路径加载。

图标字体及字符映射分别取自固定版本的[官方字体分发](https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/font/lucide.ttf)与[字符表](https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/font/lucide.css)，完整许可保存在[LICENSE.txt](icons/LICENSE.txt)。Lucide采用ISC许可，部分源自Feather的图形保留其MIT版权声明。

导航图形使用 `house`、`sparkles`、`shirt`、`user-round`。操作图形使用 `calendar-days`、`arrow-up-right`、`chevron-right`、`plus`、`heart`、`camera`、`ruler`、`user-round`、`images`、`shield-check`、`x`、`sliders-horizontal`、`image`、`check`。文件名按小程序页面所需语义命名。
