#!/usr/bin/env python3
"""Validation and rendering shared by the report command."""

from __future__ import annotations

import html
import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from _common import CASE_ID_RE, CASE_REVISION_RE, PRIORITIES, InputError


STATUSES = ("Passed", "Failed", "Blocked", "Skipped", "NotExecuted")
COVERED_STATUSES = {"Passed", "Failed"}
EXECUTORS = {"http", "agent-browser", "playwright"}
FAILURE_CLASSIFICATIONS = {
    "产品缺陷",
    "用例缺陷",
    "自动化脚本问题",
    "环境问题",
    "测试数据问题",
    "接口文档问题",
    "待分析",
}
VERIFICATION_GROUPS = {"直接验证", "影响回归", "关键链路回归"}
BUG_ID_RE = re.compile(r"^BUG-[0-9]{3,}$")
REQUIRED_MANIFEST_FIELDS = (
    "run_id",
    "plan_id",
    "application_version",
    "environment",
    "started_at",
    "ended_at",
    "cases_revision",
    "openapi_fingerprint",
    "executor_version",
    "requirements",
    "operations",
    "planned_cases",
)
REQUIRED_RESULT_FIELDS = (
    "run_id",
    "plan_id",
    "case_id",
    "case_revision",
    "attempt",
    "status",
    "case_type",
    "module",
    "priority",
    "requirement_ids",
    "source",
    "evidence",
    "executor",
    "executor_version",
)
IDENTITY_FIELDS = (
    "case_revision",
    "case_type",
    "module",
    "priority",
    "requirement_ids",
    "operation_id",
    "source",
    "executor",
    "executor_version",
)
REQUIRED_PLANNED_CASE_FIELDS = (
    "case_id",
    *IDENTITY_FIELDS,
    "required_for_conclusion",
)
SENSITIVE_KEY_RE = re.compile(
    r"(?:^|_)(?:authorization|cookie|password|passwd|secret|token|api_key|apikey)(?:$|_)",
    re.IGNORECASE,
)
SAFE_SECRET_VALUES = {"", "<redacted>", "[redacted]", "***", "****", "xxxxx"}


@dataclass(frozen=True)
class ReportModel:
    manifest: dict[str, Any]
    planned_cases: tuple[dict[str, Any], ...]
    attempts: tuple[dict[str, Any], ...]
    latest: tuple[dict[str, Any], ...]
    counts: dict[str, int]
    conclusion: str
    conclusion_policy: str
    pass_rate: float | None
    completion_rate: float | None
    requirement_coverage: float | None
    operation_coverage: float | None
    requirement_rows: tuple[dict[str, Any], ...]
    operation_rows: tuple[dict[str, Any], ...]
    verification_rows: tuple[dict[str, Any], ...]
    verification_conclusion: str | None


def _is_redacted(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    normalized = value.strip().lower()
    return normalized in SAFE_SECRET_VALUES or (normalized.startswith("${") and normalized.endswith("}"))


def _find_sensitive_values(value: Any, location: str = "$") -> list[str]:
    errors: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_location = f"{location}.{key}"
            if SENSITIVE_KEY_RE.search(str(key)) and not _is_redacted(child):
                errors.append(child_location)
            errors.extend(_find_sensitive_values(child, child_location))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            errors.extend(_find_sensitive_values(child, f"{location}[{index}]") )
    return errors


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise InputError(f"文件不存在: {path}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"JSON 无效 {path}:{exc.lineno}:{exc.colno}: {exc.msg}") from exc


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as exc:
        raise InputError(f"文件不存在: {path}") from exc
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise InputError(f"JSONL 无效 {path}:{line_number}:{exc.colno}: {exc.msg}") from exc
        if not isinstance(record, dict):
            raise InputError(f"JSONL 每行必须是对象: {path}:{line_number}")
        record["_line"] = line_number
        records.append(record)
    if not records:
        raise InputError(f"结果文件没有记录: {path}")
    return records


def _id_list(entries: Any, field: str) -> list[str]:
    if not isinstance(entries, list):
        raise InputError(f"manifest.{field} 必须是数组")
    values: list[str] = []
    for index, entry in enumerate(entries):
        value = entry if isinstance(entry, str) else entry.get("id") if isinstance(entry, dict) else None
        if not isinstance(value, str) or not value.strip():
            raise InputError(f"manifest.{field}[{index}] 必须是 ID 字符串或含 id 的对象")
        values.append(value.strip())
    if len(values) != len(set(values)):
        raise InputError(f"manifest.{field} 包含重复 ID")
    return values


def _validate_timestamp(value: str, field: str) -> None:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise InputError(f"manifest.{field} 必须是 ISO 8601 时间: {value}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InputError(f"manifest.{field} 必须包含时区: {value}")


def _validate_case_identity(record: dict[str, Any], location: str) -> None:
    if not isinstance(record.get("case_id"), str) or not CASE_ID_RE.fullmatch(record["case_id"]):
        raise InputError(f"{location}.case_id 格式无效")
    if not isinstance(record.get("case_revision"), str) or not CASE_REVISION_RE.fullmatch(record["case_revision"]):
        raise InputError(f"{location}.case_revision 格式无效")
    if record.get("case_type") not in {"接口测试", "UI 集成测试"}:
        raise InputError(f"{location}.case_type 无效")
    if not isinstance(record.get("module"), str) or not record["module"].strip():
        raise InputError(f"{location}.module 必须是非空字符串")
    if record.get("priority") not in PRIORITIES:
        raise InputError(f"{location}.priority 必须是 P0、P1、P2 或 P3")
    requirement_ids = record.get("requirement_ids")
    if not isinstance(requirement_ids, list) or not all(isinstance(item, str) and item.strip() for item in requirement_ids):
        raise InputError(f"{location}.requirement_ids 必须是字符串数组")
    if len(requirement_ids) != len(set(requirement_ids)):
        raise InputError(f"{location}.requirement_ids 包含重复 ID")
    if not isinstance(record.get("source"), (str, dict)) or not record["source"]:
        raise InputError(f"{location}.source 必须可定位")
    if not isinstance(record.get("executor"), str) or record["executor"] not in EXECUTORS:
        raise InputError(f"{location}.executor 无效")
    if not isinstance(record.get("executor_version"), str) or not record["executor_version"].strip():
        raise InputError(f"{location}.executor_version 必须是非空字符串")
    if record["case_type"] == "接口测试":
        if record["executor"] != "http":
            raise InputError(f"{location} 接口测试必须使用 http 执行器")
        if not isinstance(record.get("operation_id"), str) or not record["operation_id"].strip():
            raise InputError(f"{location} 接口测试必须提供 operation_id")
    elif record["executor"] not in {"agent-browser", "playwright"}:
        raise InputError(f"{location} UI 集成测试不能使用执行器: {record['executor']}")
    operation_id = record.get("operation_id")
    if operation_id is not None and (not isinstance(operation_id, str) or not operation_id.strip()):
        raise InputError(f"{location}.operation_id 必须是非空字符串或 null")


def _validate_planned_cases(
    entries: Any,
    requirements: list[str],
    operations: list[str],
) -> tuple[tuple[dict[str, Any], ...], dict[str, dict[str, Any]]]:
    if not isinstance(entries, list) or not entries:
        raise InputError("manifest.planned_cases 必须是非空数组")
    planned: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for index, entry in enumerate(entries):
        location = f"manifest.planned_cases[{index}]"
        if not isinstance(entry, dict):
            raise InputError(f"{location} 必须是对象")
        for field in REQUIRED_PLANNED_CASE_FIELDS:
            if field not in entry or entry[field] in (None, "") and field != "operation_id":
                raise InputError(f"{location} 缺少字段或值为空: {field}")
        _validate_case_identity(entry, location)
        if not isinstance(entry["required_for_conclusion"], bool):
            raise InputError(f"{location}.required_for_conclusion 必须是布尔值")
        group = entry.get("verification_group")
        if group is not None and group not in VERIFICATION_GROUPS:
            raise InputError(f"{location}.verification_group 无效: {group}")
        unknown_requirements = sorted(set(entry["requirement_ids"]) - set(requirements))
        if unknown_requirements:
            raise InputError(f"{location} 引用 manifest 未声明的需求: {', '.join(unknown_requirements)}")
        operation_id = entry.get("operation_id")
        if operation_id and operation_id not in operations:
            raise InputError(f"{location} 引用 manifest 未声明的 operation_id: {operation_id}")
        case_id = entry["case_id"]
        if case_id in by_id:
            raise InputError(f"manifest.planned_cases 包含重复用例 ID: {case_id}")
        by_id[case_id] = entry
        planned.append(entry)
    return tuple(planned), by_id


def _validate_verification(value: Any, planned_cases: tuple[dict[str, Any], ...]) -> dict[str, Any] | None:
    if value is None:
        if any(case.get("verification_group") is not None for case in planned_cases):
            raise InputError("常规运行的 planned_cases 不能包含 verification_group")
        return None
    if not isinstance(value, dict):
        raise InputError("manifest.verification 必须是对象")
    for field in ("bug_ids", "source_run_id", "source_application_version", "source_results"):
        if field not in value or value[field] in (None, ""):
            raise InputError(f"manifest.verification 缺少字段或值为空: {field}")
    bug_ids = value["bug_ids"]
    if not isinstance(bug_ids, list) or not bug_ids or not all(isinstance(item, str) and BUG_ID_RE.fullmatch(item) for item in bug_ids):
        raise InputError("manifest.verification.bug_ids 必须是非空 BUG ID 数组")
    if len(bug_ids) != len(set(bug_ids)):
        raise InputError("manifest.verification.bug_ids 包含重复 ID")
    for field in ("source_run_id", "source_application_version"):
        if not isinstance(value[field], str) or not value[field].strip():
            raise InputError(f"manifest.verification.{field} 必须是非空字符串")
    source_results = value["source_results"]
    if not isinstance(source_results, list) or not source_results:
        raise InputError("manifest.verification.source_results 必须是非空数组")
    source_ids: set[str] = set()
    for index, source in enumerate(source_results):
        location = f"manifest.verification.source_results[{index}]"
        if not isinstance(source, dict):
            raise InputError(f"{location} 必须是对象")
        case_id = source.get("case_id")
        if not isinstance(case_id, str) or not CASE_ID_RE.fullmatch(case_id):
            raise InputError(f"{location}.case_id 格式无效")
        if case_id in source_ids:
            raise InputError(f"manifest.verification.source_results 包含重复用例 ID: {case_id}")
        source_ids.add(case_id)
        attempts = source.get("attempts")
        if not isinstance(attempts, list) or not attempts:
            raise InputError(f"{location}.attempts 必须是非空数组")
        numbers: list[int] = []
        for attempt_index, attempt in enumerate(attempts):
            if not isinstance(attempt, dict):
                raise InputError(f"{location}.attempts[{attempt_index}] 必须是对象")
            number = attempt.get("attempt")
            status = attempt.get("status")
            if not isinstance(number, int) or isinstance(number, bool) or number < 1:
                raise InputError(f"{location}.attempts[{attempt_index}].attempt 必须是正整数")
            if status not in STATUSES:
                raise InputError(f"{location}.attempts[{attempt_index}].status 无效")
            numbers.append(number)
        if sorted(numbers) != list(range(1, len(numbers) + 1)) or len(numbers) != len(set(numbers)):
            raise InputError(f"{location}.attempts 必须从 1 开始连续递增")
    groups = [case.get("verification_group") for case in planned_cases]
    if any(group not in VERIFICATION_GROUPS for group in groups):
        raise InputError("缺陷验证运行的每个计划用例必须提供 verification_group")
    direct_ids = {case["case_id"] for case in planned_cases if case.get("verification_group") == "直接验证"}
    if not direct_ids:
        raise InputError("缺陷验证运行至少需要一个直接验证用例")
    if not direct_ids.intersection(source_ids):
        raise InputError("直接验证用例必须至少有一项关联原运行结果")
    return value


def _validate_evidence(result: dict[str, Any], results_path: Path) -> None:
    evidence = result["evidence"]
    if not isinstance(evidence, list):
        raise InputError(f"results.jsonl 第 {result['_line']} 行 evidence 必须是数组")
    if result["status"] == "Failed" and not evidence:
        raise InputError(f"results.jsonl 第 {result['_line']} 行 Failed 结果必须包含证据")
    for index, item in enumerate(evidence):
        value = item if isinstance(item, str) else item.get("path") if isinstance(item, dict) else None
        if not isinstance(value, str) or not value.strip():
            raise InputError(f"results.jsonl 第 {result['_line']} 行 evidence[{index}] 缺少 path")
        evidence_path = Path(value)
        if evidence_path.is_absolute() or ".." in evidence_path.parts:
            raise InputError(f"证据路径必须相对于运行目录且不能越界: {value}")
        resolved = (results_path.parent / evidence_path).resolve()
        if not resolved.is_relative_to(results_path.parent.resolve()):
            raise InputError(f"证据路径越出运行目录（含软链接）: {value}")
        if not resolved.is_file():
            raise InputError(f"证据文件不存在: {results_path.parent / evidence_path}")


def _validate_result(result: dict[str, Any], results_path: Path, manifest: dict[str, Any]) -> None:
    line = result["_line"]
    for field in REQUIRED_RESULT_FIELDS:
        if field not in result or result[field] in (None, ""):
            raise InputError(f"results.jsonl 第 {line} 行缺少字段或值为空: {field}")
    if result["status"] not in STATUSES:
        raise InputError(f"results.jsonl 第 {line} 行状态无效: {result['status']}")
    _validate_case_identity(result, f"results.jsonl 第 {line} 行")
    for field in ("run_id", "plan_id"):
        if result[field] != manifest[field]:
            raise InputError(
                f"results.jsonl 第 {line} 行 {field} 与 manifest 不一致: "
                f"{result[field]} != {manifest[field]}"
            )
    if not isinstance(result["attempt"], int) or isinstance(result["attempt"], bool) or result["attempt"] < 1:
        raise InputError(f"results.jsonl 第 {line} 行 attempt 必须是正整数")
    if result["status"] == "Failed":
        for field in ("failure_step", "expected", "actual", "failure_classification", "next_action"):
            if not result.get(field):
                raise InputError(f"results.jsonl 第 {line} 行 Failed 结果缺少字段: {field}")
        if result["failure_classification"] not in FAILURE_CLASSIFICATIONS:
            raise InputError(f"results.jsonl 第 {line} 行 failure_classification 无效: {result['failure_classification']}")
    elif result["status"] == "Blocked":
        for field in ("reason", "unblock_condition"):
            if not result.get(field):
                raise InputError(f"results.jsonl 第 {line} 行 Blocked 结果缺少字段: {field}")
    elif result["status"] in {"Skipped", "NotExecuted"} and not result.get("reason"):
        raise InputError(f"results.jsonl 第 {line} 行 {result['status']} 结果缺少 reason")
    if "bug_ids" in result and (
        not isinstance(result["bug_ids"], list)
        or not all(isinstance(item, str) and BUG_ID_RE.fullmatch(item) for item in result["bug_ids"])
        or len(result["bug_ids"]) != len(set(result["bug_ids"]))
    ):
        raise InputError(f"results.jsonl 第 {line} 行 bug_ids 必须是无重复的 BUG ID 数组")
    _validate_evidence(result, results_path)


def _ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _coverage_rows(ids: list[str], latest: list[dict[str, Any]], relation: str) -> tuple[tuple[dict[str, Any], ...], float | None]:
    rows: list[dict[str, Any]] = []
    covered_count = 0
    for identifier in ids:
        related = []
        for result in latest:
            values = result.get(relation) or []
            if isinstance(values, str):
                values = [values]
            if identifier in values:
                related.append(result)
        attempted = [item for item in related if item["status"] in COVERED_STATUSES]
        if attempted:
            covered_count += 1
        rows.append(
            {
                "id": identifier,
                "case_ids": sorted(item["case_id"] for item in related),
                "statuses": sorted({item["status"] for item in related}),
                "covered": bool(attempted),
            }
        )
    return tuple(rows), _ratio(covered_count, len(ids))


def _attempt_summary(attempts: list[dict[str, Any]]) -> str:
    return ", ".join(f"Attempt {item['attempt']}: {item['status']}" for item in sorted(attempts, key=lambda item: item["attempt"]))


def _verification_data(
    verification: dict[str, Any] | None,
    planned_cases: tuple[dict[str, Any], ...],
    attempts: list[dict[str, Any]],
    latest_by_case: dict[str, dict[str, Any]],
    conclusion_policy: str = "legacy-v1",
) -> tuple[tuple[dict[str, Any], ...], str | None]:
    if verification is None:
        return (), None
    source_by_case = {item["case_id"]: item for item in verification["source_results"]}
    attempts_by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for attempt in attempts:
        attempts_by_case[attempt["case_id"]].append(attempt)
    rows: list[dict[str, Any]] = []
    for case in planned_cases:
        case_id = case["case_id"]
        source = source_by_case.get(case_id)
        source_attempts = sorted(source["attempts"], key=lambda item: item["attempt"]) if source else []
        rows.append(
            {
                "case_id": case_id,
                "group": case["verification_group"],
                "source_attempts": _attempt_summary(source_attempts) if source else "不适用",
                "source_status": source_attempts[-1]["status"] if source else "不适用",
                "current_attempts": _attempt_summary(attempts_by_case[case_id]),
                "current_status": latest_by_case[case_id]["status"],
                "failure_classification": latest_by_case[case_id].get("failure_classification"),
                "product_failure": any(item["status"] == "Failed" and item.get("failure_classification") == "产品缺陷"
                                       for item in (attempts_by_case[case_id] if conclusion_policy == "testing-workflow-v1" else [latest_by_case[case_id]])),
                "unresolved_failure": conclusion_policy == "testing-workflow-v1" and any(
                    item["status"] == "Failed" and item.get("failure_classification") == "待分析" for item in attempts_by_case[case_id]),
            }
        )
    direct = [row for row in rows if row["group"] == "直接验证"]
    regression = [row for row in rows if row["group"] != "直接验证"]
    incomplete = {"Blocked", "Skipped", "NotExecuted"}
    if any(
        row["product_failure"]
        for row in direct
    ):
        conclusion = "NotFixed"
    elif any(row["unresolved_failure"] or row["current_status"] == "Failed" or row["current_status"] in incomplete for row in direct):
        conclusion = "CannotVerify"
    elif any(
        row["product_failure"]
        for row in regression
    ):
        conclusion = "RegressionFound"
    elif any(row["unresolved_failure"] or row["current_status"] == "Failed" or row["current_status"] in incomplete for row in regression):
        conclusion = "PartiallyVerified"
    else:
        conclusion = "Verified"
    return tuple(rows), conclusion


def load_report_model(manifest_path: Path, results_path: Path) -> ReportModel:
    manifest = _read_json(manifest_path)
    if not isinstance(manifest, dict):
        raise InputError("manifest.json 顶层必须是对象")
    conclusion_policy = manifest.get("conclusion_policy", "legacy-v1")
    if not isinstance(conclusion_policy, str) or conclusion_policy not in {"legacy-v1", "testing-workflow-v1"}:
        raise InputError(f"未知 conclusion_policy: {conclusion_policy}")
    for field in REQUIRED_MANIFEST_FIELDS:
        if field not in manifest or manifest[field] in (None, ""):
            raise InputError(f"manifest.json 缺少字段或值为空: {field}")
    for field in (
        "run_id",
        "plan_id",
        "application_version",
        "environment",
        "started_at",
        "ended_at",
        "cases_revision",
        "openapi_fingerprint",
        "executor_version",
    ):
        if not isinstance(manifest[field], str) or not manifest[field].strip():
            raise InputError(f"manifest.{field} 必须是非空字符串")
    _validate_timestamp(manifest["started_at"], "started_at")
    _validate_timestamp(manifest["ended_at"], "ended_at")
    requirements = _id_list(manifest["requirements"], "requirements")
    operations = _id_list(manifest["operations"], "operations")
    planned_cases, planned_by_id = _validate_planned_cases(manifest["planned_cases"], requirements, operations)
    verification = _validate_verification(manifest.get("verification"), planned_cases)
    raw_results = _read_jsonl(results_path)
    sensitive = _find_sensitive_values(manifest, "manifest")
    for result in raw_results:
        sensitive.extend(_find_sensitive_values(result, f"results[{result['_line']}]") )
        _validate_result(result, results_path, manifest)
        unknown_requirements = sorted(set(result["requirement_ids"]) - set(requirements))
        if unknown_requirements:
            raise InputError(
                f"results.jsonl 第 {result['_line']} 行引用 manifest 未声明的需求: {', '.join(unknown_requirements)}"
            )
        operation_id = result.get("operation_id")
        if operation_id and operation_id not in operations:
            raise InputError(
                f"results.jsonl 第 {result['_line']} 行引用 manifest 未声明的 operation_id: {operation_id}"
            )
        planned = planned_by_id.get(result["case_id"])
        if planned is None:
            raise InputError(f"results.jsonl 第 {result['_line']} 行包含计划外用例: {result['case_id']}")
        for field in IDENTITY_FIELDS:
            if result.get(field) != planned.get(field):
                raise InputError(
                    f"results.jsonl 第 {result['_line']} 行 {result['case_id']} 的 {field} 与计划快照不一致"
                )
    if sensitive:
        raise InputError(f"输入包含未脱敏的敏感字段: {', '.join(sorted(set(sensitive)))}")

    result_case_ids = {result["case_id"] for result in raw_results}
    missing_results = sorted(set(planned_by_id) - result_case_ids)
    if missing_results:
        raise InputError(f"计划用例缺少结果记录，必须显式写入 NotExecuted: {', '.join(missing_results)}")

    seen: set[tuple[str, int]] = set()
    for result in raw_results:
        key = (result["case_id"], result["attempt"])
        if key in seen:
            raise InputError(f"同一用例存在重复 Attempt: {result['case_id']} Attempt {result['attempt']}")
        seen.add(key)
    attempts_by_case: dict[str, list[int]] = defaultdict(list)
    for result in raw_results:
        attempts_by_case[result["case_id"]].append(result["attempt"])
    for case_id, attempt_numbers in attempts_by_case.items():
        ordered = sorted(attempt_numbers)
        if ordered != list(range(1, len(ordered) + 1)):
            raise InputError(f"用例 {case_id} 的 Attempt 必须从 1 开始连续递增: {ordered}")
    case_identities: dict[str, str] = {}
    for result in raw_results:
        identity = json.dumps(
            {field: result.get(field) for field in IDENTITY_FIELDS},
            ensure_ascii=False,
            sort_keys=True,
        )
        previous = case_identities.setdefault(result["case_id"], identity)
        if previous != identity:
            raise InputError(f"同一 Run 内用例 {result['case_id']} 的修订、来源或执行器在 Attempt 间发生变化")
    attempts = sorted(raw_results, key=lambda item: (item["case_id"], item["attempt"]))
    latest_by_case: dict[str, dict[str, Any]] = {}
    for result in attempts:
        latest_by_case[result["case_id"]] = result
    latest = [latest_by_case[key] for key in sorted(latest_by_case)]
    counts_counter = Counter(result["status"] for result in latest)
    counts = {status: counts_counter[status] for status in STATUSES}
    total = len(latest)
    pass_rate = _ratio(counts["Passed"], counts["Passed"] + counts["Failed"])
    completion_rate = _ratio(total - counts["NotExecuted"], total)
    if conclusion_policy == "testing-workflow-v1":
        # Retries preserve the original classification. A product failure requires
        # a new verification run; it cannot disappear behind a passing attempt.
        if any(item["status"] == "Failed" and item["failure_classification"] == "产品缺陷" for item in attempts):
            conclusion = "Failed"
        elif (any(item["status"] == "Failed" and item["failure_classification"] == "待分析" for item in attempts)
              or any(item["status"] != "Passed" and planned_by_id[item["case_id"]]["required_for_conclusion"] for item in latest)):
            conclusion = "Blocked"
        elif any(item["status"] != "Passed" for item in latest):
            conclusion = "PassedWithRisk"
        else:
            conclusion = "Passed"
    else:
        if counts["Failed"]:
            conclusion = "Failed"
        elif any(
            result["status"] in {"Blocked", "Skipped", "NotExecuted"}
            and planned_by_id[result["case_id"]]["required_for_conclusion"]
            for result in latest
        ):
            conclusion = "Blocked"
        elif counts["Skipped"] or counts["NotExecuted"] or any(
            result["status"] == "Failed" and latest_by_case[result["case_id"]]["status"] == "Passed"
            for result in attempts
        ):
            conclusion = "PassedWithRisk"
        else:
            conclusion = "Passed"
    requirement_rows, requirement_coverage = _coverage_rows(requirements, latest, "requirement_ids")
    operation_rows, operation_coverage = _coverage_rows(operations, latest, "operation_id")
    verification_rows, verification_conclusion = _verification_data(
        verification,
        planned_cases,
        attempts,
        latest_by_case,
        conclusion_policy,
    )
    return ReportModel(
        manifest=manifest,
        planned_cases=planned_cases,
        attempts=tuple(attempts),
        latest=tuple(latest),
        counts=counts,
        conclusion=conclusion,
        conclusion_policy=conclusion_policy,
        pass_rate=pass_rate,
        completion_rate=completion_rate,
        requirement_coverage=requirement_coverage,
        operation_coverage=operation_coverage,
        requirement_rows=requirement_rows,
        operation_rows=operation_rows,
        verification_rows=verification_rows,
        verification_conclusion=verification_conclusion,
    )


def _display(value: Any) -> str:
    if value is None or value == "":
        return "-"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _md(value: Any) -> str:
    return _display(value).replace("|", "\\|").replace("\n", "<br>")


def _anchor(kind: str, value: Any) -> str:
    text = str(value)
    readable = re.sub(r"[^A-Za-z0-9_-]+", "-", text).strip("-").lower() or "item"
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]
    return f"{kind}-{readable}-{digest}"


def _md_link(kind: str, value: Any) -> str:
    return f"[{_md(value)}](#{_anchor(kind, value)})"


def _risk_rows(model: ReportModel) -> list[dict[str, Any]]:
    attempts_by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for attempt in model.attempts:
        attempts_by_case[attempt["case_id"]].append(attempt)
    risks: list[dict[str, Any]] = []
    for result in model.latest:
        if result["priority"] not in {"P0", "P1"}:
            continue
        retried_after_failure = result["status"] == "Passed" and any(
            attempt["status"] == "Failed" for attempt in attempts_by_case[result["case_id"]][:-1]
        )
        if result["status"] == "Passed" and not retried_after_failure:
            continue
        risks.append(
            {
                "case_id": result["case_id"],
                "priority": result["priority"],
                "status": result["status"],
                "reason": "历史失败后重试通过" if retried_after_failure else result.get("failure_step") or result.get("reason"),
                "bug_ids": result.get("bug_ids", []),
            }
        )
    return risks


def _percentage(value: float | None) -> str:
    return "N/A" if value is None else f"{value * 100:.1f}%"


def _evidence_items(result: dict[str, Any], results_path: Path, output_dir: Path, html_mode: bool) -> str:
    links: list[str] = []
    for item in result.get("evidence", []):
        path_value = item if isinstance(item, str) else item["path"]
        label = path_value if isinstance(item, str) else item.get("label", path_value)
        target = os.path.relpath(results_path.parent / path_value, output_dir).replace(os.sep, "/")
        if html_mode:
            links.append(f'<a href="{html.escape(target, quote=True)}">{html.escape(str(label))}</a>')
        else:
            links.append(f"[{_md(label)}]({target.replace(' ', '%20')})")
    return ", ".join(links) or "-"


def render_markdown(model: ReportModel, results_path: Path, output_dir: Path) -> str:
    manifest = model.manifest
    total = len(model.latest)
    lines = [
        f"# 测试报告 {manifest['run_id']}",
        "",
        "## 执行结论",
        "",
        "| 项目 | 内容 |",
        "| --- | --- |",
        f"| 批次结论 | {model.conclusion} |",
        f"| 结论策略 | {model.conclusion_policy} |",
        f"| RunId | {_md(manifest['run_id'])} |",
        f"| PlanId | {_md(manifest['plan_id'])} |",
        f"| 应用版本 | {_md(manifest['application_version'])} |",
        f"| 环境 | {_md(manifest['environment'])} |",
        f"| 开始时间 | {_md(manifest.get('started_at'))} |",
        f"| 结束时间 | {_md(manifest.get('ended_at'))} |",
        "",
        "## 执行摘要",
        "",
        "| 指标 | 数量或比率 |",
        "| --- | ---: |",
        f"| 总用例数 | {total} |",
    ]
    lines.extend(
        f"| {status} | {model.counts[status]} / {total} ({_percentage(_ratio(model.counts[status], total))}) |"
        for status in STATUSES
    )
    lines.extend(
        [
            f"| 通过率（Passed / (Passed + Failed)） | {_percentage(model.pass_rate)} |",
            f"| 执行完成率（非 NotExecuted / 总数） | {_percentage(model.completion_rate)} |",
            f"| 需求覆盖率 | {_percentage(model.requirement_coverage)} |",
            f"| 接口覆盖率 | {_percentage(model.operation_coverage)} |",
            "",
            "### P0/P1 风险",
            "",
            "| 用例 ID | 优先级 | 当前状态 | 风险原因 | BUG |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    risks = _risk_rows(model)
    if risks:
        for risk in risks:
            lines.append(
                f"| {_md_link('case', risk['case_id'])} | {risk['priority']} | {risk['status']} | "
                f"{_md(risk['reason'])} | {_md(risk['bug_ids'])} |"
            )
    else:
        lines.append("| - | - | - | 无 | - |")
    lines.extend(
        [
            "",
            "## 测试范围",
            "",
            f"- 模块：{_md(manifest.get('modules', sorted({item['module'] for item in model.latest})))}",
            f"- 测试类型：{_md(manifest.get('test_types', sorted({item['case_type'] for item in model.latest})))}",
            f"- 执行器：{_md(sorted({item['executor'] for item in model.latest}))}",
            f"- 排除项：{_md(manifest.get('excluded'))}",
            f"- 探索任务：{_md(manifest.get('explorations'))}",
            "",
            "## 按模块统计",
            "",
            "| 模块 | 总数 | Passed | Failed | Blocked | Skipped | NotExecuted | 通过率 |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    modules: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in model.latest:
        modules[result["module"]].append(result)
    for module, results in sorted(modules.items()):
        counts = Counter(item["status"] for item in results)
        rate = _ratio(counts["Passed"], counts["Passed"] + counts["Failed"])
        lines.append(
            f"| {_md(module)} | {len(results)} | {counts['Passed']} | {counts['Failed']} | "
            f"{counts['Blocked']} | {counts['Skipped']} | {counts['NotExecuted']} | {_percentage(rate)} |"
        )
    lines.extend(
        [
            "",
            "## 用例结果",
            "",
            "| 用例 ID | 状态 | 执行器 | 类型 | 模块 | 优先级 |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for result in model.latest:
        lines.append(
            f"| <a id=\"{_anchor('case', result['case_id'])}\"></a>{_md(result['case_id'])} | "
            f"{result['status']} | {_md(result['executor'])} | {_md(result['case_type'])} | "
            f"{_md(result['module'])} | {result['priority']} |"
        )
    lines.extend(["", "## 失败用例", ""])
    failed = [item for item in model.latest if item["status"] == "Failed"]
    if failed:
        lines.extend(
            [
                "| 用例 ID | 执行器 | 优先级 | 来源 | 失败步骤 | 预期 | 实际 | 分类 | BUG | 证据 | 后续动作 |",
                "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            ]
        )
        for result in failed:
            lines.append(
                "| " + " | ".join(
                    [
                        _md_link("case", result["case_id"]),
                        _md(result["executor"]),
                        _md(result["priority"]),
                        _md(result["source"]),
                        _md(result["failure_step"]),
                        _md(result["expected"]),
                        _md(result["actual"]),
                        _md(result["failure_classification"]),
                        _md(result.get("bug_ids")),
                        _evidence_items(result, results_path, output_dir, False),
                        _md(result["next_action"]),
                    ]
                ) + " |"
            )
    else:
        lines.append("无当前失败用例。")
    lines.extend(["", "## 阻塞和跳过", "", "| 用例 ID | 执行器 | 状态 | 原因 | 解除条件 |", "| --- | --- | --- | --- | --- |"])
    exceptional = [item for item in model.latest if item["status"] in {"Blocked", "Skipped", "NotExecuted"}]
    if exceptional:
        for result in exceptional:
            lines.append(
                f"| {_md_link('case', result['case_id'])} | {_md(result['executor'])} | {result['status']} | {_md(result.get('reason'))} | "
                f"{_md(result.get('unblock_condition'))} |"
            )
    else:
        lines.append("| - | - | - | - | - |")
    lines.extend(["", "## 需求覆盖", "", "| 需求 ID | 关联用例 | 状态 | 已执行覆盖 |", "| --- | --- | --- | --- |"])
    for row in model.requirement_rows:
        case_links = ", ".join(_md_link("case", case_id) for case_id in row["case_ids"]) or "-"
        lines.append(
            f"| <a id=\"{_anchor('requirement', row['id'])}\"></a>{_md(row['id'])} | {case_links} | "
            f"{_md(row['statuses'])} | {'是' if row['covered'] else '否'} |"
        )
    if not model.requirement_rows:
        lines.append("| - | - | - | - |")
    lines.extend(["", "## 接口覆盖", "", "| operationId | 关联用例 | 状态 | 已执行覆盖 |", "| --- | --- | --- | --- |"])
    for row in model.operation_rows:
        case_links = ", ".join(_md_link("case", case_id) for case_id in row["case_ids"]) or "-"
        lines.append(
            f"| <a id=\"{_anchor('operation', row['id'])}\"></a>{_md(row['id'])} | {case_links} | "
            f"{_md(row['statuses'])} | {'是' if row['covered'] else '否'} |"
        )
    if not model.operation_rows:
        lines.append("| - | - | - | - |")
    lines.extend(
        [
            "",
            "## 探索测试记录",
            "",
            _display(manifest.get("exploration_summary", "本批次不包含探索测试。")),
            "",
            "## 未验证内容与残余风险",
            "",
            f"- 未验证内容：{_md(manifest.get('unverified'))}",
            f"- 残余风险：{_md(manifest.get('residual_risks'))}",
            "",
            "## 执行信息",
            "",
            f"- 用例修订：{_md(manifest.get('cases_revision'))}",
            f"- OpenAPI 指纹：{_md(manifest.get('openapi_fingerprint'))}",
            f"- 运行编排器版本：{_md(manifest.get('executor_version'))}",
            f"- 结果文件：{_md(results_path.name)}",
            "",
            "### 全部尝试",
            "",
            "| 用例 ID | Attempt | 执行器 | 执行器版本 | 状态 | 来源 | 失败分类 | 原因/步骤 | 预期 | 实际 | 后续动作 | 证据 |",
            "| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for result in model.attempts:
        lines.append(
            f"| {_md_link('case', result['case_id'])} | {result['attempt']} | {_md(result['executor'])} | "
            f"{_md(result['executor_version'])} | {result['status']} | {_md(result['source'])} | "
            f"{_md(result.get('failure_classification'))} | {_md(result.get('failure_step') or result.get('reason'))} | "
            f"{_md(result.get('expected'))} | {_md(result.get('actual'))} | {_md(result.get('next_action'))} | "
            f"{_evidence_items(result, results_path, output_dir, False)} |"
        )
    if model.verification_rows:
        verification = manifest["verification"]
        lines.extend(
            [
                "",
                "## 缺陷修复验证对比",
                "",
                f"- BUG：{_md(verification['bug_ids'])}",
                f"- 原运行：{_md(verification['source_run_id'])} / {_md(verification['source_application_version'])}",
                f"- 新运行：{_md(manifest['run_id'])} / {_md(manifest['application_version'])}",
                f"- 验证结论：{model.verification_conclusion}",
                "",
                "| 用例 ID | 验证分组 | 原运行 Attempts | 原状态 | 新运行 Attempts | 新状态 |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for row in model.verification_rows:
            lines.append(
                f"| {_md_link('case', row['case_id'])} | {row['group']} | {_md(row['source_attempts'])} | "
                f"{row['source_status']} | {_md(row['current_attempts'])} | {row['current_status']} |"
            )
    return "\n".join(lines) + "\n"


def render_html(model: ReportModel, results_path: Path, output_dir: Path) -> str:
    def e(value: Any) -> str:
        return html.escape(_display(value), quote=True)

    def attr(value: Any) -> str:
        return html.escape(str(value), quote=True)

    def display_time(value: Any) -> str:
        return datetime.fromisoformat(str(value)).strftime("%Y-%m-%d %H:%M")

    def options(values: list[str]) -> str:
        return "".join(f'<option value="{attr(value)}">{e(value)}</option>' for value in sorted(set(values)))

    def sortable_header(label: str, index: int) -> str:
        return (
            f'<th scope="col"><button type="button" class="sort-button" '
            f'data-sort-index="{index}" aria-label="按{attr(label)}排序">{e(label)}</button></th>'
        )

    def case_link(case_id: str) -> str:
        return f'<a class="entity-link" href="#{attr(_anchor("case", case_id))}">{e(case_id)}</a>'

    def relation_links(kind: str, values: list[str]) -> str:
        return ", ".join(
            f'<a class="entity-link" href="#{attr(_anchor(kind, value))}">{e(value)}</a>' for value in values
        ) or "-"

    def inline_list(values: Any) -> str:
        if isinstance(values, list):
            return ", ".join(e(value) for value in values) or "-"
        return e(values)

    def state_badge(value: str) -> str:
        tone = {
            "Passed": "passed",
            "PassedWithRisk": "risk",
            "Failed": "failed",
            "Blocked": "blocked",
            "Skipped": "skipped",
            "NotExecuted": "not-executed",
        }.get(value, "neutral")
        return f'<span class="state-badge state-{tone}">{e(value)}</span>'

    def priority_badge(value: str) -> str:
        tone = value.lower() if value in {"P0", "P1", "P2", "P3"} else "neutral"
        return f'<span class="priority-badge priority-{tone}">{e(value)}</span>'

    def coverage_badge(covered: bool) -> str:
        label = "已覆盖" if covered else "未覆盖"
        tone = "covered" if covered else "uncovered"
        return f'<span class="coverage-badge coverage-{tone}">{label}</span>'

    total = len(model.latest)
    status_distribution = "".join(
        f'<div class="status-item status-{status.lower().replace("notexecuted", "not-executed")}">'
        f'<div class="status-item-head"><span>{state_badge(status)}</span>'
        f'<strong>{model.counts[status]}</strong></div>'
        f'<div class="status-track" aria-hidden="true"><span style="width:{_percentage(_ratio(model.counts[status], total))}"></span></div>'
        f'<small>{model.counts[status]} / {total} · {_percentage(_ratio(model.counts[status], total))}</small></div>'
        for status in STATUSES
    )
    case_rows = []
    for result in model.latest:
        attempts = [item for item in model.attempts if item["case_id"] == result["case_id"]]
        attempt_items = []
        for attempt in attempts:
            attempt_items.append(
                f'<li><div class="attempt-head"><strong>Attempt {attempt["attempt"]}</strong>{state_badge(attempt["status"])}</div>'
                f"<dl class=\"detail-grid\"><dt>执行器</dt><dd>{e(attempt['executor'])} / {e(attempt['executor_version'])}</dd>"
                f"<dt>失败步骤或原因</dt><dd>{e(attempt.get('failure_step') or attempt.get('reason'))}</dd>"
                f"<dt>来源</dt><dd>{e(attempt['source'])}</dd>"
                f"<dt>失败分类</dt><dd>{e(attempt.get('failure_classification'))}</dd>"
                f"<dt>后续动作</dt><dd>{e(attempt.get('next_action'))}</dd>"
                f"<dt>预期</dt><dd>{e(attempt.get('expected'))}</dd>"
                f"<dt>实际</dt><dd>{e(attempt.get('actual'))}</dd>"
                f"<dt>证据</dt><dd>{_evidence_items(attempt, results_path, output_dir, True)}</dd></dl></li>"
            )
        requirement_data = json.dumps(result["requirement_ids"], ensure_ascii=False, separators=(",", ":"))
        has_bug = "yes" if result.get("bug_ids") else "no"
        requirement_links = relation_links("requirement", result["requirement_ids"])
        operation_link = relation_links("operation", [result["operation_id"]]) if result.get("operation_id") else "-"
        case_rows.append(
            f'<tr data-case-row data-status="{attr(result["status"])}" '
            f'data-case-type="{attr(result["case_type"])}" data-module="{attr(result["module"])}" '
            f'data-priority="{attr(result["priority"])}" data-requirements="{attr(requirement_data)}" '
            f'data-executor="{attr(result["executor"])}" '
            f'data-operation="{attr(result.get("operation_id") or "")}" '
            f'data-failure-classification="{attr(result.get("failure_classification") or "")}" '
            f'data-has-bug="{has_bug}">'
            f'<td id="{attr(_anchor("case", result["case_id"]))}"><strong class="case-id">{e(result["case_id"])}</strong></td>'
            f"<td>{state_badge(result['status'])}</td><td>{e(result['executor'])}</td>"
            f"<td>{e(result['case_type'])}</td><td>{e(result['module'])}</td>"
            f"<td>{priority_badge(result['priority'])}</td><td>{requirement_links}</td>"
            f"<td>{operation_link}</td><td>{e(result.get('failure_classification'))}</td>"
            f"<td>{inline_list(result.get('bug_ids'))}</td>"
            f'<td><details class="case-details"><summary>查看</summary><div class="details-content">'
            f"<dl class=\"detail-grid\"><dt>执行器版本</dt><dd>{e(result['executor_version'])}</dd>"
            f"<dt>失败步骤或原因</dt><dd>{e(result.get('failure_step') or result.get('reason'))}</dd>"
            f"<dt>预期</dt><dd>{e(result.get('expected'))}</dd>"
            f"<dt>实际</dt><dd>{e(result.get('actual'))}</dd>"
            f"<dt>当前证据</dt><dd>{_evidence_items(result, results_path, output_dir, True)}</dd></dl>"
            f"<h4>全部 Attempts</h4><ol class=\"attempt-list\">{''.join(attempt_items)}</ol></div></details></td></tr>"
        )
    detail_rows = []
    for result in model.latest:
        if result["status"] not in {"Failed", "Blocked", "Skipped", "NotExecuted"}:
            continue
        detail_rows.append(
            f"<tr><td>{case_link(result['case_id'])}</td><td>{e(result['executor'])}</td><td>{state_badge(result['status'])}</td>"
            f"<td>{e(result.get('failure_step') or result.get('reason'))}</td>"
            f"<td>{e(result.get('expected'))}</td><td>{e(result.get('actual'))}</td>"
            f"<td>{e(result.get('failure_classification'))}</td>"
            f"<td>{e(result.get('unblock_condition') or result.get('next_action'))}</td></tr>"
        )
    requirement_rows = "".join(
        f'<tr><td id="{attr(_anchor("requirement", row["id"]))}">{e(row["id"])}</td>'
        f"<td>{', '.join(case_link(case_id) for case_id in row['case_ids']) or '-'}</td>"
        f"<td><span class=\"badge-list\">{''.join(state_badge(status) for status in row['statuses'])}</span></td>"
        f"<td>{coverage_badge(row['covered'])}</td></tr>" for row in model.requirement_rows
    )
    operation_rows = "".join(
        f'<tr><td id="{attr(_anchor("operation", row["id"]))}">{e(row["id"])}</td>'
        f"<td>{', '.join(case_link(case_id) for case_id in row['case_ids']) or '-'}</td>"
        f"<td><span class=\"badge-list\">{''.join(state_badge(status) for status in row['statuses'])}</span></td>"
        f"<td>{coverage_badge(row['covered'])}</td></tr>" for row in model.operation_rows
    )
    module_rows = []
    modules: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in model.latest:
        modules[result["module"]].append(result)
    for module, results in sorted(modules.items()):
        counts = Counter(item["status"] for item in results)
        module_rows.append(
            f"<tr><td><strong>{e(module)}</strong></td><td>{len(results)}</td>"
            + "".join(f"<td>{counts[status]}</td>" for status in STATUSES)
            + "</tr>"
        )
    risk_rows = "".join(
        f"<tr><td>{case_link(risk['case_id'])}</td><td>{priority_badge(risk['priority'])}</td><td>{state_badge(risk['status'])}</td>"
        f"<td>{e(risk['reason'])}</td><td>{inline_list(risk['bug_ids'])}</td></tr>"
        for risk in _risk_rows(model)
    )
    verification_html = ""
    if model.verification_rows:
        verification = model.manifest["verification"]
        comparison_rows = "".join(
            f"<tr><td>{case_link(row['case_id'])}</td><td>{e(row['group'])}</td>"
            f"<td>{e(row['source_attempts'])}</td><td>{e(row['source_status'])}</td>"
            f"<td>{e(row['current_attempts'])}</td><td>{e(row['current_status'])}</td></tr>"
            for row in model.verification_rows
        )
        verification_html = (
            '<section class="report-section" id="verification"><div class="section-heading">'
            '<div><h2>缺陷修复验证对比</h2></div>'
            f'<div class="section-result">验证结论 {state_badge(model.verification_conclusion)}</div></div>'
            '<div class="verification-meta">'
            f"<div><span>BUG</span><strong>{inline_list(verification['bug_ids'])}</strong></div>"
            f"<div><span>原运行</span><strong>{e(verification['source_run_id'])} / {e(verification['source_application_version'])}</strong></div>"
            f"<div><span>新运行</span><strong>{e(model.manifest['run_id'])} / {e(model.manifest['application_version'])}</strong></div></div>"
            '<div class="table-wrap"><table class="data-table"><thead><tr><th>用例 ID</th><th>验证分组</th><th>原运行 Attempts</th><th>原状态</th>'
            f"<th>新运行 Attempts</th><th>新状态</th></tr></thead><tbody>{comparison_rows}</tbody></table></div></section>"
        )

    conclusion_tone = {
        "Passed": "passed",
        "PassedWithRisk": "risk",
        "Failed": "failed",
        "Blocked": "blocked",
    }.get(model.conclusion, "neutral")
    styles = """
:root {
  color-scheme: light;
  --ink: #171a1f;
  --muted: #667085;
  --line: #dfe3e8;
  --line-strong: #c9d0d8;
  --page: #f6f7f9;
  --surface: #ffffff;
  --subtle: #f8f9fb;
  --accent: #147d64;
  --accent-strong: #0e624e;
  --passed: #167653;
  --passed-bg: #e9f6f0;
  --failed: #bb343e;
  --failed-bg: #fcebed;
  --blocked: #a75c13;
  --blocked-bg: #fff2df;
  --skipped: #326ca8;
  --skipped-bg: #eaf2fb;
  --not-executed: #667085;
  --not-executed-bg: #eef1f4;
  --focus: rgba(20,125,100,.18);
  --shadow-soft: 0 1px 2px rgba(16,24,40,.05), 0 6px 18px rgba(16,24,40,.04);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  background: var(--page);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.55;
  letter-spacing: 0;
}
a { color: var(--accent-strong); text-underline-offset: 3px; }
a:hover { color: #084c3d; }
.report-header { border-top: 5px solid #2f3540; border-bottom: 1px solid var(--line); background: var(--surface); }
.report-header-passed { border-top-color: var(--passed); }
.report-header-risk, .report-header-blocked { border-top-color: var(--blocked); }
.report-header-failed { border-top-color: var(--failed); }
.header-inner { max-width: 1280px; margin: 0 auto; padding: 26px 32px 22px; }
.title-row { display: flex; align-items: center; justify-content: space-between; gap: 32px; }
h1 { margin: 0; color: #111318; font-size: 30px; line-height: 1.2; font-weight: 760; letter-spacing: 0; }
.run-id { margin: 7px 0 0; color: var(--muted); font: 650 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.conclusion { min-width: 186px; padding: 12px 16px; border-left: 4px solid var(--not-executed); border-radius: 6px; background: var(--not-executed-bg); }
.conclusion span { display: block; color: var(--muted); font-size: 11px; font-weight: 700; }
.conclusion strong { display: block; margin-top: 3px; color: var(--not-executed); font-size: 22px; line-height: 1.25; }
.conclusion-passed { border-left-color: var(--passed); background: var(--passed-bg); }.conclusion-passed strong { color: var(--passed); }
.conclusion-risk, .conclusion-blocked { border-left-color: var(--blocked); background: var(--blocked-bg); }.conclusion-risk strong, .conclusion-blocked strong { color: var(--blocked); }
.conclusion-failed { border-left-color: var(--failed); background: var(--failed-bg); }.conclusion-failed strong { color: var(--failed); }
.run-facts { display: grid; grid-template-columns: 1.15fr .7fr .8fr 1.35fr; gap: 18px 30px; margin: 22px 0 0; padding-top: 18px; border-top: 1px solid var(--line); }
.run-facts div { min-width: 0; }
.run-facts dt { color: var(--muted); font-size: 10px; font-weight: 750; text-transform: uppercase; }
.run-facts dd { margin: 4px 0 0; overflow-wrap: anywhere; color: #292e36; font-weight: 650; }
.time-range { display: flex; flex-wrap: wrap; gap: 4px 18px; }
.time-range span { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 6px; }
.time-range small { color: var(--muted); font-size: 10px; font-weight: 700; }
.time-range time { white-space: nowrap; }
.section-nav { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.97); backdrop-filter: blur(10px); }
.section-nav-inner { display: flex; align-items: center; max-width: 1280px; margin: 0 auto; padding: 0 32px; overflow-x: auto; scrollbar-width: none; }
.section-nav-inner::-webkit-scrollbar { display: none; }
.nav-run { flex: 0 0 auto; margin-right: 14px; padding-right: 16px; border-right: 1px solid var(--line); color: #343a43; font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.nav-links { display: flex; flex: 0 0 auto; gap: 2px; }
.section-nav a { position: relative; flex: 0 0 auto; padding: 13px 10px 12px; color: #596273; font-size: 12px; font-weight: 650; text-decoration: none; }
.section-nav a::after { position: absolute; right: 10px; bottom: -1px; left: 10px; height: 2px; content: ""; background: transparent; }
.section-nav a:hover, .section-nav a:focus-visible, .section-nav a[aria-current="true"] { color: var(--accent-strong); outline: none; }
.section-nav a:hover::after, .section-nav a:focus-visible::after, .section-nav a[aria-current="true"]::after { background: var(--accent); }
main { width: 100%; max-width: 1280px; margin: 0 auto; padding: 22px 32px 64px; overflow-x: clip; }
.report-section { padding: 34px 0; border-top: 1px solid var(--line); scroll-margin-top: 52px; }
.report-section:first-child { padding-top: 16px; border-top: 0; }
.section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
.section-heading > div:first-child { padding-left: 12px; border-left: 3px solid var(--accent); }
h2 { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 750; letter-spacing: 0; }
h3 { margin: 27px 0 10px; font-size: 15px; line-height: 1.4; font-weight: 730; letter-spacing: 0; }
h4 { margin: 20px 0 8px; font-size: 13px; }
.section-kicker { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.section-result { color: var(--muted); font-size: 12px; white-space: nowrap; }
.metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.metric { min-width: 0; padding: 17px 18px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-soft); }
.metric strong { color: var(--muted); font-size: 11px; font-weight: 700; }
.metric-value { display: block; margin-top: 6px; color: #171a1f; font-size: 25px; line-height: 1.15; font-weight: 760; }
.metric-emphasis { border-top: 3px solid var(--accent); padding-top: 15px; }
.status-distribution { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin-top: 14px; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.status-item { min-width: 0; padding: 14px 15px; border-left: 1px solid var(--line); }
.status-item:first-child { border-left: 0; }
.status-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.status-item-head strong { font-size: 18px; }
.status-item small { display: block; margin-top: 7px; color: var(--muted); }
.status-track { height: 4px; margin-top: 10px; overflow: hidden; border-radius: 2px; background: var(--not-executed-bg); }
.status-track span { display: block; height: 100%; background: var(--not-executed); }
.status-passed .status-track span { background: var(--passed); }
.status-failed .status-track span { background: var(--failed); }
.status-blocked .status-track span { background: var(--blocked); }
.status-skipped .status-track span { background: var(--skipped); }
.filter-panel { margin-bottom: 14px; padding: 16px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-soft); }
.filter-grid { display: grid; grid-template-columns: repeat(5, minmax(132px, 1fr)); gap: 12px; }
.filter-grid-secondary { grid-template-columns: repeat(4, minmax(150px, 1fr)); margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
label { display: grid; gap: 5px; min-width: 0; color: #535d6d; font-size: 11px; font-weight: 700; }
select { width: 100%; min-height: 38px; padding: 7px 30px 7px 10px; border: 1px solid var(--line-strong); border-radius: 6px; color: var(--ink); background: var(--surface); font-family: inherit; font-size: 12px; font-weight: 550; line-height: 1.3; }
select:hover { border-color: #96a0ae; }
select:focus-visible { border-color: var(--accent); outline: 3px solid var(--focus); }
.filter-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; }
#visible-count { margin: 0; color: var(--muted); font-size: 12px; font-weight: 650; }
.reset-button { min-height: 34px; padding: 6px 12px; border: 1px solid var(--line-strong); border-radius: 6px; color: #394150; background: var(--surface); font-family: inherit; font-size: 12px; font-weight: 650; line-height: 1; cursor: pointer; }
.reset-button:hover { border-color: var(--accent); color: var(--accent-strong); background: #edf7f4; }
.reset-button:disabled { border-color: var(--line); color: #98a0ac; background: #f2f4f6; cursor: default; }
.reset-button:focus-visible, .sort-button:focus-visible, summary:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.table-wrap { width: 100%; max-width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: 0 1px 2px rgba(16,24,40,.03); scrollbar-width: thin; }
.data-table { width: 100%; min-width: 720px; border-collapse: separate; border-spacing: 0; background: var(--surface); }
.data-table-wide { min-width: 1180px; }
th, td { padding: 12px 13px; border: 0; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
thead th { position: sticky; top: 0; z-index: 2; color: #4d5665; background: #f1f3f6; font-size: 11px; font-weight: 730; white-space: nowrap; }
tbody tr:nth-child(even) > td { background: #fbfcfd; }
tbody tr:last-child > * { border-bottom: 0; }
tbody tr:hover > td { background: #f3f8f6; }
.sort-button { position: relative; padding: 0 16px 0 0; border: 0; color: inherit; background: none; font: inherit; cursor: pointer; }
.sort-button::after { position: absolute; top: 50%; right: 1px; width: 6px; height: 6px; border-right: 1.5px solid #8c96a5; border-bottom: 1.5px solid #8c96a5; content: ""; transform: translateY(-65%) rotate(45deg); }
.sort-button[data-direction="asc"]::after { border-color: var(--accent); transform: translateY(-25%) rotate(225deg); }
.sort-button[data-direction="desc"]::after { border-color: var(--accent); transform: translateY(-65%) rotate(45deg); }
.entity-link { font-weight: 680; text-decoration-color: #9bc4ba; }
.case-id { font: 680 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
.state-badge, .priority-badge, .coverage-badge { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid transparent; border-radius: 999px; font-size: 11px; line-height: 1; font-weight: 720; white-space: nowrap; }
.badge-list { display: inline-flex; flex-wrap: wrap; gap: 5px; }
.state-passed, .coverage-covered { color: var(--passed); border-color: #b8ddcb; background: var(--passed-bg); }
.state-failed { color: var(--failed); border-color: #efc1c5; background: var(--failed-bg); }
.state-blocked, .state-risk { color: var(--blocked); border-color: #efd1a3; background: var(--blocked-bg); }
.state-skipped { color: var(--skipped); border-color: #c5d8ee; background: var(--skipped-bg); }
.state-not-executed, .state-neutral, .coverage-uncovered { color: var(--not-executed); border-color: #d3d9df; background: var(--not-executed-bg); }
.priority-p0 { color: #a92c36; border-color: #efc1c5; background: var(--failed-bg); }
.priority-p1 { color: #96520f; border-color: #efd1a3; background: var(--blocked-bg); }
.priority-p2 { color: #315f8e; border-color: #c5d8ee; background: var(--skipped-bg); }
.priority-p3, .priority-neutral { color: #5f6876; border-color: #d3d9df; background: var(--not-executed-bg); }
.case-details { min-width: 82px; }
.case-details summary { width: fit-content; padding: 5px 9px; border: 1px solid var(--line-strong); border-radius: 5px; color: var(--accent-strong); background: var(--surface); font-size: 11px; font-weight: 700; cursor: pointer; list-style-position: inside; }
.case-details[open] summary { border-color: var(--accent); background: #edf7f4; }
.details-content { width: min(560px, 72vw); padding: 15px 2px 2px; }
.detail-grid { display: grid; grid-template-columns: 108px minmax(0, 1fr); gap: 7px 12px; margin: 0; }
.detail-grid dt { color: var(--muted); font-size: 11px; font-weight: 700; }
.detail-grid dd { margin: 0; }
.attempt-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.attempt-list li { padding: 12px; border-left: 3px solid var(--line-strong); border-radius: 0 6px 6px 0; background: var(--subtle); }
.attempt-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.empty-row { padding: 28px; color: var(--muted); text-align: center; }
.verification-meta { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 1px; margin-bottom: 14px; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--line); }
.verification-meta div { padding: 14px; background: var(--surface); }
.verification-meta span { display: block; color: var(--muted); font-size: 11px; font-weight: 700; }
.verification-meta strong { display: block; margin-top: 3px; overflow-wrap: anywhere; }
.note-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.note-block { min-height: 80px; padding: 14px 16px; border: 1px solid var(--line); border-left: 3px solid var(--line-strong); border-radius: 6px; background: var(--surface); }
.note-block h3 { margin: 0 0 5px; font-size: 12px; }
.note-block p { margin: 0; color: #46505f; }
.report-footer { padding: 22px 0 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
[hidden] { display: none !important; }
@media (max-width: 980px) {
  .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .status-distribution { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .status-item { border-top: 1px solid var(--line); }
  .status-item:nth-child(-n+3) { border-top: 0; }
  .status-item:nth-child(4) { border-left: 0; }
  .filter-grid { grid-template-columns: repeat(3, minmax(132px,1fr)); }
  .filter-grid-secondary { grid-template-columns: repeat(2, minmax(150px,1fr)); }
}
@media (max-width: 680px) {
  .header-inner { padding: 22px 18px 18px; }
  .title-row { align-items: stretch; gap: 18px; }
  h1 { font-size: 26px; }
  .conclusion { min-width: 154px; }
  .run-facts { grid-template-columns: 1fr 1fr; gap: 14px 18px; }
  .run-facts div:last-child { grid-column: 1 / -1; }
  .section-nav-inner { padding: 0 12px; }
  .nav-run { display: none; }
  main { padding: 18px 16px 42px; }
  .report-section { padding: 28px 0; }
  .section-heading { align-items: flex-start; gap: 10px; }
  .metrics { grid-template-columns: 1fr 1fr; }
  .metric:last-child { grid-column: 1 / -1; }
  .status-distribution { grid-template-columns: 1fr 1fr; }
  .status-item:nth-child(3) { border-top: 1px solid var(--line); border-left: 0; }
  .status-item:nth-child(4) { border-left: 1px solid var(--line); }
  .status-item:nth-child(5) { grid-column: 1 / -1; border-left: 0; }
  .filter-grid, .filter-grid-secondary { grid-template-columns: 1fr 1fr; }
  .note-grid, .verification-meta { grid-template-columns: 1fr; }
  .details-content { width: 68vw; }
}
@media (max-width: 420px) {
  .title-row { display: grid; grid-template-columns: 1fr; }
  .conclusion { width: 100%; min-width: 0; }
  .filter-grid, .filter-grid-secondary { grid-template-columns: 1fr; }
  .run-facts div:first-child, .run-facts div:last-child { grid-column: 1 / -1; }
  .time-range { display: grid; }
  .section-heading { display: block; }
  .section-result { margin-top: 8px; white-space: normal; }
  .detail-grid { grid-template-columns: 1fr; gap: 3px; }
  .detail-grid dd { margin-bottom: 7px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
@media print {
  body { background: #fff; }
  .report-header { border-top-width: 2px; }
  .section-nav, .filter-panel { display: none; }
  main { max-width: none; padding: 0; overflow: visible; }
  .metric, .table-wrap, .note-block { box-shadow: none; }
  .table-wrap { overflow: visible; border-color: #aaa; }
  .data-table { min-width: 0; font-size: 9px; }
  .report-section { break-inside: avoid; }
}
"""
    script = """
const caseTable=document.getElementById('case-results');
const caseBody=caseTable.tBodies[0];
const caseRows=()=>Array.from(caseBody.querySelectorAll('tr[data-case-row]'));
const filters=Array.from(document.querySelectorAll('[data-filter]'));
const resetButton=document.getElementById('reset-filters');
function matches(row,filter){
  if(filter.value==='')return true;
  const field=filter.dataset.filter;
  if(field==='requirements'){
    try{return JSON.parse(row.dataset.requirements).includes(filter.value);}catch(error){return false;}
  }
  return (row.dataset[field]||'')===filter.value;
}
function applyFilters(){
  let visible=0;
  for(const row of caseRows()){row.hidden=!filters.every(filter=>matches(row,filter));if(!row.hidden)visible++;}
  document.getElementById('visible-count').textContent=`显示 ${visible} / ${caseRows().length} 个用例`;
  resetButton.disabled=filters.every(filter=>filter.value==='');
}
for(const filter of filters)filter.addEventListener('change',applyFilters);
resetButton.addEventListener('click',()=>{for(const filter of filters)filter.value='';applyFilters();});
for(const button of caseTable.querySelectorAll('[data-sort-index]')){
  button.addEventListener('click',()=>{
    const index=Number(button.dataset.sortIndex);
    const direction=button.dataset.direction==='asc'?'desc':'asc';
    for(const other of caseTable.querySelectorAll('[data-sort-index]')){
      delete other.dataset.direction;
      other.closest('th').removeAttribute('aria-sort');
    }
    button.dataset.direction=direction;
    button.closest('th').setAttribute('aria-sort',direction==='asc'?'ascending':'descending');
    const factor=direction==='asc'?1:-1;
    caseRows().sort((left,right)=>left.cells[index].textContent.trim().localeCompare(right.cells[index].textContent.trim(),'zh-CN',{numeric:true})*factor).forEach(row=>caseBody.appendChild(row));
  });
}
const navLinks=Array.from(document.querySelectorAll('.section-nav a'));
const navSections=navLinks.map(link=>document.querySelector(link.getAttribute('href'))).filter(Boolean);
function setCurrentNav(sectionId){
  for(const link of navLinks){
    if(link.getAttribute('href')===`#${sectionId}`)link.setAttribute('aria-current','true');
    else link.removeAttribute('aria-current');
  }
}
function updateCurrentNav(){
  let current=navSections[0];
  for(const section of navSections){if(section.getBoundingClientRect().top<=96)current=section;else break;}
  if(current)setCurrentNav(current.id);
}
let navFrame=0;
window.addEventListener('scroll',()=>{
  if(navFrame)return;
  navFrame=requestAnimationFrame(()=>{navFrame=0;updateCurrentNav();});
},{passive:true});
for(const link of navLinks)link.addEventListener('click',()=>setCurrentNav(link.hash.slice(1)));
updateCurrentNav();
applyFilters();
"""
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>测试报告 {e(model.manifest['run_id'])}</title>
<style>{styles}</style>
</head>
<body>
<header class="report-header report-header-{conclusion_tone}">
  <div class="header-inner">
    <div class="title-row">
      <div><h1>测试报告</h1><p class="run-id">{e(model.manifest['run_id'])}</p></div>
      <div class="conclusion conclusion-{conclusion_tone}"><span>批次结论</span><strong>{e(model.conclusion)}</strong></div>
    </div>
    <dl class="run-facts">
      <div><dt>结论策略</dt><dd>{e(model.conclusion_policy)}</dd></div>
      <div><dt>Plan ID</dt><dd>{e(model.manifest['plan_id'])}</dd></div>
      <div><dt>应用版本</dt><dd>{e(model.manifest['application_version'])}</dd></div>
      <div><dt>测试环境</dt><dd>{e(model.manifest['environment'])}</dd></div>
      <div><dt>执行时间</dt><dd class="time-range"><span><small>开始</small><time datetime="{attr(model.manifest['started_at'])}">{display_time(model.manifest['started_at'])}</time></span><span><small>结束</small><time datetime="{attr(model.manifest['ended_at'])}">{display_time(model.manifest['ended_at'])}</time></span></dd></div>
    </dl>
  </div>
</header>
<nav class="section-nav" aria-label="报告分区"><div class="section-nav-inner">
  <span class="nav-run">{e(model.manifest['run_id'])}</span><div class="nav-links">
    <a href="#overview">概览</a><a href="#risks">高优风险</a><a href="#cases">用例结果</a>
    <a href="#failures">失败与阻塞</a><a href="#coverage">覆盖分析</a><a href="#evidence">执行证据</a><a href="#residual">残余风险</a>
  </div>
</div></nav>
<main>
  <section class="report-section" id="overview">
    <div class="section-heading"><div><h2>执行概览</h2><p class="section-kicker">当前批次的结果、完成度与覆盖情况</p></div></div>
    <div class="metrics">
      <div class="metric metric-emphasis"><strong>总用例数</strong><span class="metric-value">{len(model.latest)}</span></div>
      <div class="metric"><strong>通过率</strong><span class="metric-value">{_percentage(model.pass_rate)}</span></div>
      <div class="metric"><strong>完成率</strong><span class="metric-value">{_percentage(model.completion_rate)}</span></div>
      <div class="metric"><strong>需求覆盖率</strong><span class="metric-value">{_percentage(model.requirement_coverage)}</span></div>
      <div class="metric"><strong>接口覆盖率</strong><span class="metric-value">{_percentage(model.operation_coverage)}</span></div>
    </div>
    <div class="status-distribution" aria-label="用例状态分布">{status_distribution}</div>
  </section>
  <section class="report-section" id="risks">
    <div class="section-heading"><div><h2>P0/P1 风险</h2><p class="section-kicker">高优先级未通过项与重试风险</p></div></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>用例 ID</th><th>优先级</th><th>当前状态</th><th>风险原因</th><th>BUG</th></tr></thead><tbody>{risk_rows or '<tr><td class="empty-row" colspan="5">无高优先级风险</td></tr>'}</tbody></table></div>
  </section>
  <section class="report-section" id="cases">
    <div class="section-heading"><div><h2>用例结果</h2><p class="section-kicker">最终状态、执行身份与全部尝试记录</p></div></div>
    <div class="filter-panel" aria-label="用例筛选">
      <div class="filter-grid">
        <label for="status-filter">状态<select id="status-filter" data-filter="status"><option value="">全部</option>{options(list(STATUSES))}</select></label>
        <label for="priority-filter">优先级<select id="priority-filter" data-filter="priority"><option value="">全部</option>{options([item['priority'] for item in model.latest])}</select></label>
        <label for="module-filter">模块<select id="module-filter" data-filter="module"><option value="">全部</option>{options([item['module'] for item in model.latest])}</select></label>
        <label for="type-filter">类型<select id="type-filter" data-filter="caseType"><option value="">全部</option>{options([item['case_type'] for item in model.latest])}</select></label>
        <label for="executor-filter">执行器<select id="executor-filter" data-filter="executor"><option value="">全部</option>{options([item['executor'] for item in model.latest])}</select></label>
      </div>
      <div class="filter-grid filter-grid-secondary">
        <label for="requirement-filter">需求<select id="requirement-filter" data-filter="requirements"><option value="">全部</option>{options([item for result in model.latest for item in result['requirement_ids']])}</select></label>
        <label for="operation-filter">operationId<select id="operation-filter" data-filter="operation"><option value="">全部</option>{options([item['operation_id'] for item in model.latest if item.get('operation_id')])}</select></label>
        <label for="classification-filter">失败分类<select id="classification-filter" data-filter="failureClassification"><option value="">全部</option>{options([item['failure_classification'] for item in model.latest if item.get('failure_classification')])}</select></label>
        <label for="bug-filter">关联 BUG<select id="bug-filter" data-filter="hasBug"><option value="">全部</option><option value="yes">是</option><option value="no">否</option></select></label>
      </div>
      <div class="filter-actions"><p id="visible-count" aria-live="polite"></p><button class="reset-button" id="reset-filters" type="button">重置筛选</button></div>
    </div>
    <div class="table-wrap"><table class="data-table data-table-wide" id="case-results"><thead><tr>{sortable_header('用例 ID', 0)}{sortable_header('状态', 1)}{sortable_header('执行器', 2)}{sortable_header('类型', 3)}{sortable_header('模块', 4)}{sortable_header('优先级', 5)}{sortable_header('需求', 6)}{sortable_header('operationId', 7)}{sortable_header('失败分类', 8)}{sortable_header('BUG', 9)}<th scope="col">详情</th></tr></thead><tbody>{''.join(case_rows)}</tbody></table></div>
  </section>
  <section class="report-section" id="failures">
    <div class="section-heading"><div><h2>失败与阻塞</h2><p class="section-kicker">需要处理、解除或追踪的执行项</p></div></div>
    <div class="table-wrap"><table class="data-table data-table-wide"><thead><tr><th>用例 ID</th><th>执行器</th><th>状态</th><th>失败步骤或原因</th><th>预期</th><th>实际</th><th>分类</th><th>后续动作或解除条件</th></tr></thead><tbody>{''.join(detail_rows) or '<tr><td class="empty-row" colspan="8">无失败或阻塞项</td></tr>'}</tbody></table></div>
  </section>
  <section class="report-section" id="coverage">
    <div class="section-heading"><div><h2>覆盖分析</h2><p class="section-kicker">需求、接口与模块维度的执行覆盖</p></div></div>
    <div class="note-block"><h3>排除项</h3><p>{inline_list(model.manifest.get('excluded'))}</p></div>
    <h3>需求覆盖</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>需求 ID</th><th>关联用例</th><th>状态</th><th>已执行覆盖</th></tr></thead><tbody>{requirement_rows or '<tr><td class="empty-row" colspan="4">无需求范围</td></tr>'}</tbody></table></div>
    <h3>接口覆盖</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>operationId</th><th>关联用例</th><th>状态</th><th>已执行覆盖</th></tr></thead><tbody>{operation_rows or '<tr><td class="empty-row" colspan="4">无接口范围</td></tr>'}</tbody></table></div>
    <h3>模块风险矩阵</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>模块</th><th>总数</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>Skipped</th><th>NotExecuted</th></tr></thead><tbody>{''.join(module_rows)}</tbody></table></div>
  </section>
  {verification_html}
  <section class="report-section" id="evidence">
    <div class="section-heading"><div><h2>执行证据</h2></div></div>
    <p>证据链接已列在用例结果中。已知敏感字段在生成前经过拒绝检查，执行器仍须先完成内容脱敏。</p>
  </section>
  <section class="report-section" id="residual">
    <div class="section-heading"><div><h2>未验证内容与残余风险</h2></div></div>
    <div class="note-grid"><div class="note-block"><h3>未验证内容</h3><p>{inline_list(model.manifest.get('unverified'))}</p></div><div class="note-block"><h3>残余风险</h3><p>{inline_list(model.manifest.get('residual_risks'))}</p></div></div>
  </section>
  <footer class="report-footer">用例修订 {e(model.manifest.get('cases_revision'))} · OpenAPI {e(model.manifest.get('openapi_fingerprint'))} · 运行编排器 {e(model.manifest.get('executor_version'))} · 结果文件 {e(results_path.name)}</footer>
</main>
<script>{script}</script>
</body></html>
"""
