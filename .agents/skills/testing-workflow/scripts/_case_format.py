"""Restricted Markdown structure and named-data validation (standard library only)."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from _common import CASE_ID_RE, DRAFT_HINTS, LIFECYCLE_STATUSES, PRIORITIES, Case, infer_case_type

WIKILINK_RE = re.compile(r"\[\[([^\[\]]+)\]\]")
CASE_HEADING_RE = re.compile(r"^### ([^｜]+)｜(.+)$")
SECTION_NAMES = {"准备", "数据", "步骤", "最终检查", "清理"}
ATTRIBUTES = {"用例编号", "优先级", "状态", "处理提示", "处理依据", "关联需求", "关联风险", "来源", "来源依据", "关联接口"}
STEP_FIELDS = {"操作", "检查", "观察", "等待", "并发", "保存为"}
COMMON_REFERENCE_RE = re.compile(r'满足[“"]公共准备[”"]')
DEFINITION_RE = re.compile(r"^\s*-\s+([^：]+)：\s*(.+)$")


def visible_lines(lines: list[str]) -> tuple[list[tuple[int, str, bool]], list[str]]:
    """Keep code verbatim for fingerprints while shielding it from structural parsing."""
    result, errors = [], []
    fence = None
    for number, line in enumerate(lines, 1):
        marker = re.match(r"^\s*(`{3,}|~{3,})(.*)$", line)
        if fence is None and marker:
            fence = (marker.group(1), number)
            result.append((number, line, False))
        elif fence is not None:
            result.append((number, line, False))
            if re.fullmatch(r"\s*" + re.escape(fence[0][0]) + "{" + str(len(fence[0])) + r",}\s*", line):
                fence = None
        else:
            result.append((number, line, True))
    if fence:
        errors.append(f"第 {fence[1]} 行代码围栏未闭合")
    return result, errors


def normalized(rows: list[tuple[int, str, bool]]) -> list[str]:
    # Blank lines in code can be meaningful; prose-only blank lines are presentation.
    return [text.rstrip() if visible else text for _, text, visible in rows if text.strip() or not visible]


def references(text: str) -> list[str]:
    text = re.sub(r'“[^”]*”|"[^"\n]*"|`[^`]*`', "", text)
    return re.findall(r"「([^「」]+)」", text)


def vague(text: str) -> bool:
    value = re.sub(r"[\s。.!！；;：:]", "", text)
    return value in {"正确", "正常", "符合预期", "结果正确", "结果正常", "结果符合预期"}


def _named_checks(shared, sections, steps, errors):
    definitions = {}
    for number, text, visible in shared + sections.get("准备", []) + sections.get("数据", []):
        match = DEFINITION_RE.match(text) if visible else None
        if match:
            name, value = match.group(1).strip(), match.group(2).strip()
            if name in definitions:
                errors.append(f"第 {number} 行具名数据重复声明: {name}")
            definitions[name] = (value, number)
    dependencies = {name: references(value) for name, (value, _) in definitions.items()}
    visiting, visited = set(), set()

    def visit(name):
        if name in visiting:
            errors.append(f"第 {definitions[name][1]} 行具名数据存在循环定义: {name}")
            return
        if name in visited:
            return
        visiting.add(name)
        for target in dependencies[name]:
            if target in definitions:
                visit(target)
        visiting.remove(name)
        visited.add(name)

    for name in definitions:
        visit(name)
    available = set(definitions)

    def check_rows(rows):
        for number, text, visible in rows:
            if visible:
                for name in references(text):
                    if name not in available:
                        errors.append(f"第 {number} 行引用未定义或尚未产生的具名数据: {name}")

    check_rows(shared + sections.get("准备", []) + sections.get("数据", []))
    for step in steps:
        for field, rows in step:
            check_rows(rows)
            if field == "保存为":
                nonempty = [(n, t.strip(), v) for n, t, v in rows if t.strip()]
                if len(nonempty) != 1 or not re.fullmatch(r"[^←：]+\s*←\s*.+", nonempty[0][1]):
                    errors.append(f"第 {rows[0][0]} 行保存为必须为单个‘名称 ← 来源’")
                    continue
                name = nonempty[0][1].split("←", 1)[0].strip()
                if name in available:
                    errors.append(f"第 {rows[0][0]} 行具名数据重复声明: {name}")
                available.add(name)
    check_rows(sections.get("最终检查", []) + sections.get("清理", []))


def parse_document(path: Path, cases_dir: Path):
    relative = path.relative_to(cases_dir).as_posix()
    rows, errors = visible_lines(path.read_text(encoding="utf-8").splitlines())
    headings = [(n, t) for n, t, v in rows if v and t.startswith("# ")]
    if len(headings) != 1 or not headings[0][1][2:].strip():
        errors.append("必须且只能有一个非空一级功能标题")
    document_title = headings[0][1][2:].strip() if len(headings) == 1 else None
    h2 = [(n, t[3:]) for n, t, v in rows if v and t.startswith("## ")]
    if [name for _, name in h2] not in (["用例"], ["公共准备", "用例"]):
        errors.append("二级章节必须为可选的 ## 公共准备，随后为唯一 ## 用例")
    starts = [i for i, (_, text, visible) in enumerate(rows) if visible and text.startswith("### ")]
    if not starts:
        errors.append("缺少 ### CaseId｜名称 用例正文")
    first_case = starts[0] if starts else len(rows)
    separators = {}
    for case_index, start in enumerate(starts[1:], 1):
        previous = start - 1
        while previous >= 0 and not rows[previous][1].strip():
            previous -= 1
        if previous < 0 or not rows[previous][2] or rows[previous][1].strip() != "---":
            errors.append(f"第 {rows[start][0]} 行用例前必须使用独立的 --- 分割线")
        else:
            separators[case_index] = previous
    separator_indexes = set(separators.values())
    for index, (number, text, visible) in enumerate(rows):
        if visible and text.strip() == "---" and index not in separator_indexes:
            errors.append(f"第 {number} 行分割线只能位于两条用例之间")
    intro = rows[:first_case]
    first_section = next((n for n, t, v in rows if v and t.startswith("## ")), len(rows) + 1)
    entrances = [(n, link) for n, t, v in intro if v and n < first_section for link in WIKILINK_RE.findall(t)]
    if len(entrances) != 1:
        errors.append("功能标题后必须有一个返回唯一测试地图的 Wikilink")
    navigation_rows = set()
    for n, t, v in rows:
        link = re.fullmatch(r"\[\[([^\[\]]+)\]\]", t.strip()) if v and n > first_section else None
        if link and link.group(1).partition("|")[2] in {
                "返回测试地图", "测试地图", "返回测试用例", "返回接口测试用例", "返回 UI 测试用例"}:
            entrances.append((n, link.group(1)))
            navigation_rows.add(n)
    common = []
    common_active = False
    for number, text, visible in intro:
        if visible and text.startswith("## "):
            common_active = text == "## 公共准备"
        elif common_active:
            common.append((number, text, visible))
        elif text.strip() and not (visible and (text.startswith("# ") or WIKILINK_RE.search(text))):
            errors.append(f"第 {number} 行功能首部只能包含标题、地图入口及公共准备")
    if "公共准备" in [title for _, title in h2] and not normalized(common):
        errors.append("公共准备为空，应省略该章节")
    blocks = {}
    for n, t, v in rows:
        if v:
            for anchor in re.findall(r"\^([A-Za-z0-9-]+)\s*$", t):
                if anchor in blocks:
                    errors.append(f"第 {n} 行块标识重复: {anchor}（首次位于第 {blocks[anchor]} 行）")
                blocks[anchor] = n
    case_type = infer_case_type(relative)
    if not case_type:
        errors.append("用例必须位于 01-api 或 02-ui-integration 类型目录内")
    filename = path.name
    filename_match = re.fullmatch(r"(?:0[1-9]|[1-9][0-9])-(.+)\.md", filename)
    if not filename_match:
        errors.append("模块用例文件必须使用两位非零编号和模块名称，如 01-预约管理.md")
    elif document_title and filename_match.group(1) != document_title:
        errors.append(f"模块用例文件名称必须与一级标题一致: {filename_match.group(1)} != {document_title}")
    cases = []
    for index, start in enumerate(starts):
        end = separators.get(index + 1, starts[index + 1]) if index + 1 < len(starts) else len(rows)
        number, heading, _ = rows[start]
        match = CASE_HEADING_RE.fullmatch(heading)
        if not match or not CASE_ID_RE.fullmatch(match.group(1).strip()) or not match.group(2).strip():
            errors.append(f"第 {number} 行标题必须为 ### CaseId｜名称")
            continue
        case_id, title = match.group(1).strip(), match.group(2).strip()
        if not any(n < number and section == "用例" for n, section in h2):
            errors.append(f"第 {number} 行用例须位于 ## 用例 之后")
        attrs, sections = {}, {}
        current = None
        for n, text, visible in rows[start + 1:end]:
            if n in navigation_rows:
                continue
            section = re.fullmatch(r"#### (.+)", text) if visible else None
            if section:
                current = section.group(1)
                if current not in SECTION_NAMES:
                    errors.append(f"第 {n} 行未知用例分区: {current}")
                if current in sections:
                    errors.append(f"第 {n} 行重复用例分区: {current}")
                sections.setdefault(current, [])
            elif visible and text.startswith("#"):
                errors.append(f"第 {n} 行不支持的用例内标题: {text}")
            elif current:
                sections[current].append((n, text, visible))
            elif text.strip():
                attr = re.fullmatch(r"([^：]+)：\s*(.+)", text) if visible else None
                if not attr or attr.group(1) not in ATTRIBUTES:
                    errors.append(f"第 {n} 行未知或空用例属性: {text}")
                elif attr.group(1) in attrs:
                    errors.append(f"第 {n} 行重复用例属性: {attr.group(1)}")
                else:
                    attrs[attr.group(1)] = attr.group(2).strip()
                    if attr.group(1) == "用例编号":
                        neighbors = ([rows[n - 2]] if n > 1 else []) + ([rows[n]] if n < len(rows) else [])
                        if any(t.strip() and not (v and re.match(r"^#{1,6}\s", t)) for _, t, v in neighbors):
                            errors.append(f"第 {n} 行用例编号块必须为独立段落，前后留空行（标题可作为段落边界）")
        for name in ("准备", "步骤"):
            if name not in sections:
                errors.append(f"第 {number} 行 {case_id} 缺少必需分区: {name}")
        for name, content in sections.items():
            if not normalized(content):
                errors.append(f"第 {number} 行 {case_id} 的 {name} 分区为空")
        anchor = "case-" + case_id.lower()
        if attrs.get("用例编号") != f"{case_id} ^{anchor}":
            errors.append(f"第 {number} 行标题、用例编号和块标识须一致: 用例编号：{case_id} ^{anchor}")
        for attr, choices in (("优先级", PRIORITIES), ("状态", LIFECYCLE_STATUSES)):
            if attrs.get(attr) not in choices:
                errors.append(f"第 {number} 行缺少或无效{attr}: {attrs.get(attr, '')}")
        if "处理提示" in attrs or "处理依据" in attrs:
            if attrs.get("状态") != "草拟":
                errors.append(f"第 {number} 行处理提示和处理依据仅适用于草拟用例")
            if attrs.get("处理提示") not in DRAFT_HINTS or not attrs.get("处理依据"):
                errors.append(f"第 {number} 行处理提示须为待独立评审、待修订、待复核或待澄清，并同时填写非空处理依据")
        ids = {}
        for key in ("关联需求", "关联风险"):
            values = re.split(r"[、,，\s]+", attrs.get(key, "")) if key in attrs else []
            if any(not CASE_ID_RE.fullmatch(value) for value in values):
                errors.append(f"第 {number} 行 {key} 必须为明确编号列表")
            ids[key] = tuple(sorted(set(values)))
        if not ids["关联需求"] and (attrs.get("来源") not in {"契约", "回归", "探索"} or not attrs.get("来源依据")):
            errors.append(f"第 {number} 行缺少关联需求，或来源及非空来源依据")
        if "来源" in attrs and attrs["来源"] not in {"契约", "回归", "探索"}:
            errors.append(f"第 {number} 行来源必须为契约、回归或探索")
        operation = attrs.get("关联接口")
        if case_type == "接口测试" and (not operation or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", operation)):
            errors.append(f"第 {number} 行接口用例须有单个关联接口 operationId")
        steps, active_step, active_field = [], None, None
        next_step = 1
        step_field_indent = None
        for n, text, visible in sections.get("步骤", []):
            step = re.fullmatch(r"(\d+)\.\s+(.+)", text) if visible else None
            field = re.fullmatch(r"\s*(?:-\s+)?([^：]+)：\s*(.*)", text) if visible else None
            field_indent = len(text) - len(text.lstrip())
            at_field_level = field and (step_field_indent is None or field_indent <= step_field_indent)
            if step:
                if int(step.group(1)) != next_step:
                    errors.append(f"第 {n} 行步骤编号必须连续，应为 {next_step}")
                next_step += 1
                active_step = []
                steps.append(active_step)
                active_field = None
                step_field_indent = None
            elif at_field_level:
                if active_step is None:
                    errors.append(f"第 {n} 行步骤字段必须位于编号步骤内")
                    continue
                if field.group(1).strip() not in STEP_FIELDS:
                    errors.append(f"第 {n} 行未知步骤字段: {field.group(1).strip()}")
                    continue
                if step_field_indent is not None and field_indent != step_field_indent:
                    errors.append(f"第 {n} 行步骤字段须与本步骤首个字段同级缩进")
                    continue
                step_field_indent = field_indent
                active_field = (field.group(1).strip(), [(n, field.group(2), True)])
                active_step.append(active_field)
            elif text.strip():
                if active_field is None:
                    errors.append(f"第 {n} 行步骤内容缺少操作／检查等字段")
                else:
                    active_field[1].append((n, text, visible))
        if not steps:
            errors.append(f"第 {number} 行缺少连续编号步骤")
        checks = []
        for offset, step in enumerate(steps, 1):
            if not any(name == "操作" and normalized(content) for name, content in step):
                errors.append(f"第 {number} 行步骤 {offset} 缺少非空操作")
            for name, content in step:
                if not normalized(content):
                    errors.append(f"第 {number} 行步骤 {offset} 的 {name} 字段为空")
                if name == "检查":
                    checks.extend((n, re.sub(r"^\s*-\s*", "", t).strip()) for n, t, v in content if v and t.strip())
        final_checks = [(n, re.sub(r"^\s*-\s*", "", t).strip()) for n, t, v in sections.get("最终检查", []) if v and t.strip()]
        checks = [(n, t) for n, t in checks if t]
        final_checks = [(n, t) for n, t in final_checks if t]
        if not checks + final_checks:
            errors.append(f"第 {number} 行用例缺少可观察检查判定")
        for n, text in checks + final_checks:
            if vague(text):
                errors.append(f"第 {n} 行检查仅为模糊判定: {text}")
        uses_common = any(v and COMMON_REFERENCE_RE.search(t) for _, t, v in sections.get("准备", []))
        if uses_common and not normalized(common):
            errors.append(f"第 {number} 行引用公共准备但没有公共定义")
        effective_common = common if uses_common else []
        _named_checks(effective_common, sections, steps, errors)
        semantic = {"public_preparation": normalized(effective_common), "operation_id": operation,
                    "sections": {key: normalized(value) for key, value in sections.items() if key != "步骤"},
                    "steps": [[{"field": name, "content": normalized(content)} for name, content in step] for step in steps]}
        digest = hashlib.sha256(json.dumps(semantic, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        cases.append(Case(case_id=case_id, case_revision="h-" + digest[:12], title=title,
                          case_type=case_type or "", priority=attrs.get("优先级", ""),
                          lifecycle_status=attrs.get("状态", ""), requirement_ids=ids["关联需求"], risk_ids=ids["关联风险"],
                          source_kind="需求" if ids["关联需求"] else attrs.get("来源", ""),
                          source_reference="、".join(ids["关联需求"]) if ids["关联需求"] else attrs.get("来源依据", ""),
                          operation_id=operation, source_file=relative, source_line=number, anchor=anchor,
                          draft_hint=attrs.get("处理提示", ""), draft_hint_source=attrs.get("处理依据", "")))
    return cases, [f"{relative}: {message}" for message in errors], entrances
