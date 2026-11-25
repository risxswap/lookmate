# 小程序本地视觉资源

`editorial.jpg` 来自项目已有的 `apps/web/public/images/auth-editorial.webp`，等比例缩小并转换为JPEG，用于品牌展示及明确的空状态。

小程序「整体」页的女款 `overall-design-example.jpg` 与男款 `overall-design-example-male.jpg` 均由内置 ImageGen 生成。每张图用头肩近景和全身照展示同一位虚构模特。女款和男款分别等比例缩小为 817×950 和 760×950，导出为 JPEG。图注由页面渲染。

<details>
<summary>女款生成提示词</summary>

```text
Use case: photorealistic-natural.
Create a single portrait 4:5 fashion editorial diptych for a mobile app’s full-look example. Two vertical photos sit directly side by side, with a clean straight seam at about 43% width. Both photos depict the same fictional East Asian adult woman in the same understated everyday outfit, with the same haircut and pale warm-neutral studio backdrop.
Left: head-and-shoulders three-quarter closeup, with her entire short dark textured bob, subtle side part, and facial outline clearly visible. Right: relaxed standing full-body photo from head to shoes, showing the same hairstyle, muted sage tailored jacket, ivory knit top, straight charcoal trousers and simple black flats. Keep the outfit silhouette and fabric texture distinct. Soft directional daylight, natural skin texture, restrained tones and realistic proportions. Both the crown of her hair and her shoes have comfortable breathing room from the outer edges.
The image is the photograph pair only. No text, labels, graphics, logos, borders, extra panels, or people.
```

</details>

<details>
<summary>男款生成提示词</summary>

```text
Use case: photorealistic-natural.
Create a single vertical fashion editorial diptych, about 4:5, for a mobile app’s men's full-look example. Two shots sit directly side by side, with a straight seam at about 45% width. Both shots depict the same fictional East Asian adult man with identical dark short textured hair, identical clothes and a warm beige studio backdrop in soft, directional daylight.
Left: close head-and-shoulders portrait from a slight three-quarter angle, with all his short layered hair, natural side sweep, and facial outline readable at small size. Right: full-body standing portrait, with the same hairstyle and the full outfit visible from head to feet. He wears a muted olive relaxed overshirt, ivory crewneck, dark charcoal straight-leg trousers and simple dark leather shoes. Use natural skin and textile texture, gentle warmth, unforced posture, and clear headroom and floor around the shoes.
The file is the two photographs as one edge-to-edge picture. No text, logos, watermark, decorative border, extra people, or panels.
```

</details>

`icons/` 中的PNG由Lucide Static 0.468.0官方字体渲染，统一线宽。原生导航使用81×81透明图片，其他操作图标使用96×96透明图片。默认导航颜色为 `#666f65`，选中及操作图标颜色为 `#304f40`，浅色箭头为 `#fffefa`。构建直接复制PNG，页面通过本地路径加载。

图标字体及字符映射分别取自固定版本的[官方字体分发](https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/font/lucide.ttf)与[字符表](https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/font/lucide.css)，完整许可保存在[LICENSE.txt](icons/LICENSE.txt)。Lucide采用ISC许可，部分源自Feather的图形保留其MIT版权声明。

导航图形使用 `house`、`sparkles`、`shirt`、`user-round`。操作图形使用 `calendar-days`、`arrow-up-right`、`chevron-right`、`plus`、`heart`、`camera`、`ruler`、`user-round`、`images`、`shield-check`、`x`、`sliders-horizontal`、`image`、`check`。文件名按小程序页面所需语义命名。

已收藏状态使用 `heart-filled.png`，以墨绿填充 `heart.png` 的内部，两者共用同一轮廓和透明边距。
