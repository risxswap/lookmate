# 身体尺寸图示来源

图示取自 Web 的 [`bodySilhouette.ts`](../../../../web/src/features/profile/bodySilhouette.ts) 和 [`BodyMeasurementEditor.tsx`](../../../../web/src/features/profile/BodyMeasurementEditor.tsx)（生成基线 `5d5bfa1`；原图来源见 Web 的 `bodySilhouette.SOURCE.md`）。沿用正背面共用轮廓的做法，背面由标题和专用标线区分。手机端裁切局部、加粗长标线，不带 Web 的引导线。

Web 轮廓或标线更新后，从 `apps/miniapp/` 运行 `node scripts/generate-measurement-guides.mjs`，复核裁切及脚部方向，再提交新 PNG。仅重新制图需要 Node 24、已安装的 TypeScript、支持 SVG 的 macOS `sips`，以及带 Pillow 的 `python3`。构建和运行只用随包 PNG，不读取 Web 或调用这些工具。
