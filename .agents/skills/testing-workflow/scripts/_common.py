#!/usr/bin/env python3
"""Shared identities, source boundaries and loading for Chinese Markdown cases."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any

PRIORITIES = {"P0", "P1", "P2", "P3"}
PRIORITY_ORDER = {value: index for index, value in enumerate(sorted(PRIORITIES))}
LIFECYCLE_STATUSES = {"草拟", "可执行", "已废弃"}
STATUS_LABELS = {"草拟": "🟠 草拟", "可执行": "🔵 可执行", "已废弃": "⚪ 已废弃"}
DRAFT_HINTS = {"待独立评审", "待修订", "待复核", "待澄清"}
CASE_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$")
CASE_REVISION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
MAP_SPECS = {
    "接口测试": ("01-api/00-接口测试用例.md", "# 接口测试用例"),
    "UI 集成测试": ("02-ui-integration/00-UI测试用例.md", "# UI 测试用例"),
}


class InputError(ValueError):
    """A source or invocation that cannot be processed."""


@dataclass(frozen=True)
class Case:
    case_id: str
    case_revision: str
    title: str
    case_type: str
    priority: str
    lifecycle_status: str
    requirement_ids: tuple[str, ...]
    risk_ids: tuple[str, ...]
    source_kind: str
    source_reference: str
    operation_id: str | None
    source_file: str
    source_line: int
    anchor: str
    classification_path: tuple[str, ...] = ()
    draft_hint: str = ""
    draft_hint_source: str = ""

    @property
    def map_status_label(self) -> str:
        label = STATUS_LABELS.get(self.lifecycle_status, self.lifecycle_status)
        return f"{label} · {self.draft_hint}" if self.draft_hint else label

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        for key in ("requirement_ids", "risk_ids", "classification_path"):
            result[key] = list(result[key])
        for key in ("draft_hint", "draft_hint_source"):
            if not result[key]:
                del result[key]
        return result


@dataclass(frozen=True)
class Context:
    cases_dir: Path
    vault_root: Path
    api_map_path: Path
    ui_map_path: Path
    testing_root: Path | None

    @property
    def map_paths(self) -> tuple[Path, ...]:
        return tuple(path for path in (self.api_map_path, self.ui_map_path) if path.is_file())

    def map_for(self, case_type: str) -> Path:
        return self.api_map_path if case_type == "接口测试" else self.ui_map_path


def resolve_cases_dir(path: Path) -> Path:
    path = path.resolve()
    if path.name in {"01-api", "02-ui-integration"}:
        raise InputError(f"必须扫描完整用例根，不能只扫描类型子目录: {path}")
    candidates = [candidate for candidate in (
        path / "docs" / "testing" / "01-cases",
        path / "testing" / "01-cases",
        path / "01-cases",
    ) if candidate.is_dir()]
    if len(candidates) > 1:
        raise InputError("发现多套测试资产；请显式指定完整用例根: " + "、".join(str(p) for p in candidates))
    if candidates:
        return candidates[0]
    return path


def resolve_context(input_path: Path, vault_root: Path | None = None,
                    api_map_path: Path | None = None,
                    ui_map_path: Path | None = None) -> Context:
    cases_dir = resolve_cases_dir(input_path)
    if not cases_dir.is_dir():
        raise InputError(f"用例目录不存在或不是目录: {cases_dir}")
    standard = cases_dir.name == "01-cases" and cases_dir.parent.name == "testing"
    if not standard and vault_root is None:
        raise InputError("无法推导自定义用例根的项目边界；请提供 --asset-root（兼容 --vault-root）")
    testing_root = cases_dir.parent if standard else next((p for p in (cases_dir, *cases_dir.parents) if p.name == "testing"), None)
    default_vault = testing_root.parent if testing_root is not None else None
    if default_vault is not None and default_vault.name == "docs":
        default_vault = default_vault.parent
    vault = Path(vault_root).resolve() if vault_root is not None else default_vault
    if not vault.is_dir():
        raise InputError(f"资产根不存在或不是目录: {vault}")
    selected_maps = (
        Path(api_map_path).resolve() if api_map_path is not None else (cases_dir / MAP_SPECS["接口测试"][0]).resolve(),
        Path(ui_map_path).resolve() if ui_map_path is not None else (cases_dir / MAP_SPECS["UI 集成测试"][0]).resolve(),
    )
    if selected_maps[0] == selected_maps[1]:
        raise InputError("接口测试与 UI 测试必须使用不同的全局地图")
    for target in (cases_dir, *selected_maps):
        if not target.is_relative_to(vault):
            raise InputError(f"路径越出资产根边界: {target}")
    for target, explicit in zip(selected_maps, (api_map_path, ui_map_path)):
        if target.exists() and not target.is_file():
            raise InputError(f"测试地图不是文件: {target}")
        if explicit is not None and not target.is_file():
            raise InputError(f"显式指定的测试地图不存在: {target}")
    present_maps = {target for target in selected_maps if target.is_file()}
    candidates = []
    map_search_root = testing_root if testing_root is not None else vault
    for item in map_search_root.rglob("*.md"):
        if not item.is_file() or not item.resolve().is_relative_to(map_search_root):
            continue
        lines = item.read_text(encoding="utf-8").splitlines()
        if ("# 测试地图" in lines or "# 测试用例" in lines
                or (lines[:3] == ["---", "mindmap-plugin: basic", "---"]
                    and any(title in lines[3:] for _, title in MAP_SPECS.values()))):
            candidates.append(item.resolve())
    candidates = sorted(set(candidates) | present_maps)
    if set(candidates) != present_maps:
        raise InputError("测试项目包含未选定的全局地图: " + "、".join(str(p) for p in candidates))
    return Context(cases_dir, vault, selected_maps[0], selected_maps[1], testing_root)


def discover_markdown_files(cases_dir: Path, map_paths: tuple[Path, ...] = ()) -> list[Path]:
    excluded = {path.resolve() for path in map_paths}
    files = sorted(
        (path for path in cases_dir.rglob("*.md") if path.resolve() not in excluded),
        key=lambda p: p.relative_to(cases_dir).as_posix(),
    )
    for path in files:
        if not path.is_file() or not path.resolve().is_relative_to(cases_dir):
            raise InputError(f"用例文件无效或越出用例根: {path}")
    return files


def infer_case_type(relative_path: str) -> str | None:
    return {"01-api": "接口测试", "02-ui-integration": "UI 集成测试"}.get(Path(relative_path).parts[0])


def parse_case_file(path: Path, cases_dir: Path) -> tuple[list[Case], list[str]]:
    from _case_format import parse_document
    cases, errors, _ = parse_document(path, cases_dir)
    return cases, errors


def load_cases(input_path: Path, vault_root: Path | None = None,
               api_map_path: Path | None = None,
               ui_map_path: Path | None = None) -> tuple[Path, list[Case], list[str]]:
    from _case_format import parse_document
    from _case_map import validate_map
    context = resolve_context(input_path, vault_root, api_map_path, ui_map_path)
    files = discover_markdown_files(context.cases_dir, context.map_paths)
    cases, errors, entrances = [], [], {}
    if not files:
        errors.append(f"{context.cases_dir}: 用例目录中没有 Markdown 用例文件")
    for path in files:
        parsed, issues, links = parse_document(path, context.cases_dir)
        cases.extend(parsed)
        errors.extend(issues)
        entrances[path.resolve()] = links
    locations: dict[str, list[str]] = {}
    for case in cases:
        locations.setdefault(case.case_id, []).append(f"{case.source_file}:{case.source_line}")
    for case_id, values in sorted(locations.items()):
        if len(values) > 1:
            errors.append(f"重复用例编号 {case_id}: {', '.join(values)}")
    classifications = {}
    for case_type, (_, title) in MAP_SPECS.items():
        type_files = [path for path in files if infer_case_type(path.relative_to(context.cases_dir).as_posix()) == case_type]
        type_cases = [case for case in cases if case.case_type == case_type]
        type_entrances = {path: entrances[path] for path in type_files}
        if not context.map_for(case_type).is_file():
            if type_files or type_cases:
                errors.append(f"{case_type}存在用例但缺少全局地图: {context.map_for(case_type)}")
            continue
        mapped, map_errors = validate_map(
            context, context.map_for(case_type), title, type_cases, type_files, type_entrances
        )
        classifications.update(mapped)
        errors.extend(map_errors)
    cases = [replace(case, classification_path=classifications.get(case.case_id, ())) for case in cases]
    return context.cases_dir, sorted(cases, key=lambda case: case.case_id), errors


def canonical_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
