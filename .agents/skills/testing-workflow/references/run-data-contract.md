# 运行数据契约

本契约仅适用于正式运行；临时验证保留 Markdown 记录，不伪造 CaseId 或 PlanId。仅在创建、校验或解释 `manifest.json`、`results.jsonl` 和缺陷验证报告时读取本文件。两个文件使用 UTF-8；结果文件每个非空行是一个 JSON 对象。

## Manifest

`docs/testing/04-runs/<RunId>/manifest.json` 必须包含：

| 字段 | 类型与含义 |
| --- | --- |
| `run_id`、`plan_id` | 非空字符串，分别绑定本次运行和已冻结且在授权范围内执行的计划 |
| `application_version`、`environment` | 实际被测版本和环境 |
| `started_at`、`ended_at` | 带时区的 ISO 8601 时间 |
| `cases_revision` | 本轮用例正文和实际涉及类型的全局地图共同组成的来源快照 Git 修订或内容哈希 |
| `openapi_fingerprint` | 本轮接口来源指纹，支持 OpenAPI 或其他明确的在线／本地接口说明；保留字段名以兼容，不涉及接口时写 `不适用` |
| `executor_version` | 生成和汇总运行事实的编排器版本 |
| `conclusion_policy` | 新运行必填 `testing-workflow-v1`；历史兼容见下文，不将新运行伪装成旧策略 |
| `requirements`、`operations` | 本轮分母中的全部需求 ID 和 OpenAPI `operationId`；可为空数组 |
| `planned_cases` | 本轮计划的逐场景不可变快照；必须为非空数组 |

范围和限制使用以下可选字段；有对应事实时必须填写，没有条目时写空数组。它们用于报告说明，不改变计划分母、逐例状态或整体结论算法。

| 字段 | 类型与来源 |
| --- | --- |
| `excluded` | 字符串数组；来自已冻结计划的明确排除项及理由，不能把执行失败事后改成排除项 |
| `unverified` | 字符串数组；来自实际未完成的验证及解除条件，计划内未执行场景仍必须保留对应结果 |
| `residual_risks` | 字符串数组；记录当前证据支持的残余风险或适用限制，不将“无发现”解释为无风险或发布批准 |

历史输入省略这些字段时，报告可能显示占位符；这不构成“没有排除或风险”的事实。生成新报告前，对照计划和实际结果核对这些说明，不能只确认报告文件已生成。

`planned_cases` 每项必须包含：

| 字段 | 规则 |
| --- | --- |
| `case_id`、`case_revision` | 对应中文正文的稳定 CaseId 与 Schema v5 目录自动生成的执行语义指纹 |
| `case_type` | `接口测试` 或 `UI 集成测试` |
| `module`、`priority` | 模块取地图 `classification_path` 的业务功能节点并随计划冻结；优先级为 `P0`、`P1`、`P2` 或 `P3` |
| `requirement_ids` | 字符串数组，不得引用 Manifest 未声明的需求 |
| `operation_id` | 接口测试必填且必须在 `operations` 中；UI 可为 `null` |
| `source` | 可定位的用例路径与行号，或包含等价定位信息的对象 |
| `executor`、`executor_version` | 计划选定的执行器与实际版本；接口使用 `http` 类别，实际通过 curl 命令执行，版本填写 `curl <实际版本>`；UI 使用 `agent-browser` 或 `playwright` |
| `required_for_conclusion` | 布尔值；为真时阻塞、跳过或未执行将使批次无法形成通过结论 |
| `verification_group` | 缺陷验证运行必填：`直接验证`、`影响回归` 或 `关键链路回归`；常规运行不得填写 |

目录到计划的映射以 [格式契约](test-case-format.md) 的 Schema v5 为准。读取 `case_id`、`case_revision`、`case_type`、`priority`、`requirement_ids` 和 `operation_id`；`source` 合成用例根、`source_file` 与真实 `source_line`，可附加 `anchor`。`module` 取所属类型地图的 `classification_path` 业务功能节点。所涉及地图和文档哈希冻结集合来源，单条 `case_revision` 冻结执行语义。报告读取运行中的不可变快照，不重新读取当前正文来解释既有结果。

合成字段示例（不是已执行记录；版本、哈希、来源和时间必须替换成实际值）：

```json
{
  "conclusion_policy": "testing-workflow-v1",
  "run_id": "RUN-20260908-001",
  "plan_id": "PLAN-20260908-001",
  "application_version": "1.2.3",
  "environment": "test-01",
  "started_at": "2026-09-08T10:00:00+08:00",
  "ended_at": "2026-09-08T10:15:00+08:00",
  "cases_revision": "abc123",
  "openapi_fingerprint": "sha256:def456",
  "executor_version": "test-orchestrator 1.0.0",
  "requirements": ["REQ-USER-001"],
  "operations": ["getUser"],
  "planned_cases": [
    {
      "case_id": "API-USER-001",
      "case_revision": "h-0123456789ab",
      "case_type": "接口测试",
      "module": "用户",
      "priority": "P0",
      "requirement_ids": ["REQ-USER-001"],
      "operation_id": "getUser",
      "source": "docs/testing/01-cases/01-api/01-用户管理.md:18",
      "executor": "http",
      "executor_version": "curl <实际版本>",
      "required_for_conclusion": true
    }
  ]
}
```

## Results

每个计划用例必须至少有一条结果。未开始也要写入 `NotExecuted`；生成器对遗漏或计划外结果报错，不自行补造事实。

每条结果必须重复计划快照中的 `run_id`、`plan_id`、`case_id`、`case_revision`、`case_type`、`module`、`priority`、`requirement_ids`、`operation_id`、`source`、`executor` 和 `executor_version`，并包含：

| 字段 | 规则 |
| --- | --- |
| `attempt` | 从 1 开始连续递增的正整数 |
| `status` | `Passed`、`Failed`、`Blocked`、`Skipped` 或 `NotExecuted` |
| `evidence` | 相对运行目录的文件路径数组，或含 `path`、可选 `label` 的对象数组；不能越界 |

状态特定字段：

| 状态 | 附加要求 |
| --- | --- |
| `Passed` | 没有额外必填字段；仍需满足计划证据要求 |
| `Failed` | 必须提供 `failure_step`、`expected`、`actual`、`failure_classification`、`next_action` 和至少一项证据 |
| `Blocked` | 必须提供 `reason` 和 `unblock_condition` |
| `Skipped`、`NotExecuted` | 必须提供 `reason` |

`failure_classification` 只能是 `产品缺陷`、`用例缺陷`、`自动化脚本问题`、`环境问题`、`测试数据问题`、`接口文档问题` 或 `待分析`。可选 `bug_ids` 必须是无重复的 `BUG-NNN` 数组。

同一用例的 Attempts 必须保持全部计划身份字段不变。代码、配置、契约、用例语义、关键数据或执行器变化时创建新计划和新 `RunId`。

## 缺陷验证

缺陷验证 Manifest 额外包含：

```json
{
  "verification": {
    "bug_ids": ["BUG-001"],
    "source_run_id": "RUN-20260901-001",
    "source_application_version": "1.2.2",
    "source_results": [
      {
        "case_id": "API-USER-001",
        "attempts": [
          {"attempt": 1, "status": "Failed"}
        ]
      }
    ]
  }
}
```

所有当前计划用例同时填写 `verification_group`，且至少有一个关联原运行结果的直接验证用例。新策略 `testing-workflow-v1` 按以下顺序派生：

1. 直接验证的任意 Attempt 有产品失败，为 `NotFixed`。
2. 直接验证的任意 Attempt 有待分析失败，或最新结果为 Failed／Blocked／Skipped／NotExecuted，为 `CannotVerify`。
3. 回归的任意 Attempt 有产品失败，为 `RegressionFound`。
4. 回归的任意 Attempt 有待分析失败，或最新结果为 Failed／Blocked／Skipped／NotExecuted，为 `PartiallyVerified`。
5. 其余为 `Verified`。

直接验证优先。历史 `legacy-v1` 保持相同分组顺序，但只检查各用例最新状态和分类，不回看历史 Attempt。批次整体结论单独计算，非必测回归缺口的 PassedWithRisk 不表示 BUG 已完整验证。

## 整体结论策略与历史兼容

新运行的 Manifest 必须写 `conclusion_policy: "testing-workflow-v1"`。报告按以下顺序计算，不改写单例状态：

1. 全部 Attempt 中存在确认的 `产品缺陷` 失败，整体为 `Failed`；后续重试通过也不能覆盖这一事实。
2. 没有确认产品缺陷，但任何 Attempt 存在 `待分析` 失败，整体为 `Blocked`。
3. 以上均无且任一必测用例最新 Attempt 不为 `Passed`，整体为 `Blocked`。
4. 必测全通过，仅非必测用例最新 Attempt 未通过，整体为 `PassedWithRisk`，列出实际缺口。
5. 全部要求满足时为 `Passed`。已分类为非产品问题的历史失败在同条件重试后通过，不强制降为带风险通过，但所有尝试、分类和证据仍展示。

失败分类必须有分析依据，不能为得到通过结论修改事实或把待分析随意归类。修复产品后的验证在新 RunId 进行，旧运行仍保留失败。

历史 Manifest 缺失本字段或显式为 `legacy-v1` 时沿用旧算法并在报告展示策略：任何最新 Failed 为 Failed；必测最新 Blocked／Skipped／NotExecuted 为 Blocked；最新 Skipped／NotExecuted，或存在 Failed 后最新 Passed 为 PassedWithRisk；其余 Passed。旧算法在只有可选 Blocked 且无重试时可能得到 Passed，此行为仅用于回放历史；新策略已将这种缺口判为 PassedWithRisk。未知策略被拒绝。重生成历史报告不补字段改变旧结论，新运行不使用历史兼容入口。

## 脱敏和生成

认证头、Cookie、Token、密码、个人数据和敏感业务值必须在写入 Manifest、结果或证据前脱敏。生成器会拒绝部分已知敏感键，但该检查不能替代执行器的内容脱敏。

从目标项目根使用以下命令同时校验输入并生成两种报告，`<技能目录>` 替换为已安装的 testing-workflow 路径：

```shell
python3 <技能目录>/scripts/generate_report.py \
  --manifest docs/testing/04-runs/<RunId>/manifest.json \
  --results docs/testing/04-runs/<RunId>/results.jsonl \
  --output-dir docs/testing/05-reports/<RunId>
```

已创建 `RunId` 的测试计划结束后必须执行该命令，并确认输出目录中的 `report.html` 可读取。HTML 报告是执行完成的必要交付产物；`report.md` 是生成器同时产生的同源辅助视图。输入不完整或生成失败时保留运行事实并报告错误，不手工拼接报告或伪造缺失结果。
