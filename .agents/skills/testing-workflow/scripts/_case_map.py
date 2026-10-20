"""Validate one type-specific hand-maintained Obsidian business index."""
from __future__ import annotations

import re
from pathlib import Path

from _case_format import WIKILINK_RE, visible_lines
from _common import CASE_ID_RE, Context, InputError


def link_target(link: str, context: Context) -> tuple[Path, str | None, str | None]:
    target, separator, alias = link.partition("|")
    document, has_anchor, anchor = target.partition("#")
    if (not document or document.startswith(("/", "~")) or "\\" in document
            or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", document)):
        raise InputError(f"链接必须使用 Vault 内完整文档路径: [[{link}]]")
    if any(part in {"", ".", ".."} for part in document.split("/")):
        raise InputError(f"链接路径不允许空段、. 或 ..: [[{link}]]")
    path = (context.vault_root / (document if document.endswith(".md") else document + ".md")).resolve()
    if not path.is_relative_to(context.vault_root):
        raise InputError(f"链接目标越出 Vault（含软链接）: [[{link}]]")
    if not path.is_file():
        raise InputError(f"链接目标文件不存在: [[{link}]]")
    return path, anchor if has_anchor else None, alias if separator else None


def validate_map(context: Context, map_path: Path, expected_title: str, cases, files, entrances):
    errors, classifications = [], {}
    map_label = map_path.relative_to(context.vault_root).as_posix()
    file_set = {file.resolve() for file in files}
    by_target = {(context.cases_dir / case.source_file).resolve(): {} for case in cases}
    for case in cases:
        by_target[(context.cases_dir / case.source_file).resolve()][case.anchor] = case
    for path, links in entrances.items():
        for number, link in links:
            try:
                target, anchor, _ = link_target(link, context)
                if target != map_path or anchor:
                    raise InputError(f"功能首部入口须指向所属测试类型的全局地图: [[{link}]]")
            except InputError as exc:
                errors.append(f"{path}:{number}: {exc}")
    lines = map_path.read_text(encoding="utf-8").splitlines()
    rows, fence_errors = visible_lines(lines)
    errors.extend(f"{map_label}: {error}" for error in fence_errors)
    for number, line in enumerate(lines, 1):
        if re.match(r"^\s*(`{3,}|~{3,})", line):
            errors.append(f"{map_label}:{number}: 测试用例地图不允许代码围栏")
    if lines[:3] != ["---", "mindmap-plugin: basic", "---"]:
        errors.append(f"{map_label}: 文件必须以且只能以 mindmap-plugin: basic frontmatter 开始")
    h1 = [(n, t) for n, t, v in rows if v and t.startswith("# ")]
    if len(h1) != 1 or h1[0][1] != expected_title:
        errors.append(f"{map_label}: 必须且只能有一个 {expected_title} 一级标题")
    title_line = h1[0][0] if len(h1) == 1 and h1[0][1] == expected_title else None
    stack, nodes = [], []
    seen_ids = set()
    for number, text, visible in rows:
        if not visible or not text.strip():
            continue
        if number <= 3:
            continue
        if text == expected_title:
            continue
        if title_line is None or number < title_line:
            errors.append(f"{map_label}:{number}: 根标题前不允许其他内容")
            continue
        topic = re.fullmatch(r"##\s+(.+)", text) if visible else None
        if topic:
            stack = []
            node = {"indent": -1, "body": topic.group(1).strip(), "leaf": False,
                    "children": 0, "number": number}
            nodes.append(node)
            stack.append(node)
            continue
        item = re.fullmatch(r"([ \t]*)-\s+(.+)", text)
        if not item:
            errors.append(f"{map_label}:{number}: 根标题后只能包含业务二级标题或实际无序列表节点")
            continue
        indent, body = len(item.group(1).expandtabs(2)), item.group(2).strip()
        while stack and stack[-1]["indent"] >= indent:
            stack.pop()
        if not stack and indent != 0:
            errors.append(f"{map_label}:{number}: 顶层分类必须从零缩进开始")
        if stack:
            stack[-1]["children"] += 1
            if stack[-1]["leaf"]:
                errors.append(f"{map_label}:{number}: 用例叶子不能有子节点")
            if "child_indent" in stack[-1] and stack[-1]["child_indent"] != indent:
                errors.append(f"{map_label}:{number}: 同一分类的直接子节点须使用一致缩进")
            stack[-1]["child_indent"] = indent
        link = re.fullmatch(r"([^｜\[\]]+)｜(.+?)｜\[\[([^\[\]]+)\]\]", body)
        node = {"indent": indent, "body": body, "leaf": bool(link), "children": 0, "number": number}
        nodes.append(node)
        if link:
            status_label, short_title, value = link.groups()
            try:
                if (not short_title.strip() or WIKILINK_RE.search(short_title)
                        or re.search(r"!?\[[^\]]*\]\([^)]*\)|<a\b|<https?://", short_title, re.IGNORECASE)):
                    raise InputError("叶子标题必须为非空普通文字，仅末尾编号可作为链接")
                if len(stack) < 3:
                    raise InputError("用例叶子至少需要主题、业务功能、规则三个分类祖先")
                target, anchor, alias = link_target(value, context)
                if target not in file_set:
                    raise InputError(f"地图目标不属于本次扫描用例集合: [[{value}]]")
                if not anchor or not re.fullmatch(r"\^[A-Za-z0-9-]+", anchor):
                    raise InputError(f"地图链接必须指向明确块标识: [[{value}]]")
                if not CASE_ID_RE.fullmatch(alias or ""):
                    raise InputError(f"末尾链接显示必须仅为 CaseId: [[{value}]]")
                case = by_target.get(target, {}).get(anchor[1:])
                if not case:
                    raise InputError(f"链接目标缺少对应的用例编号块: [[{value}]]")
                if case.case_id != alias:
                    raise InputError(f"叶子显示编号与目标身份不一致: [[{value}]]")
                if status_label != case.map_status_label:
                    raise InputError(f"地图状态或处理提示与正文不一致，应为 {case.map_status_label}: [[{value}]]")
                if case.case_id in seen_ids:
                    raise InputError(f"重复主叶子: {case.case_id}")
                seen_ids.add(case.case_id)
                classifications[case.case_id] = tuple(parent["body"] for parent in stack)
            except InputError as exc:
                errors.append(f"{map_label}:{number}: {exc}")
        elif WIKILINK_RE.search(body) or body.startswith(("[ ]", "[x]", "[X]")):
            errors.append(f"{map_label}:{number}: 叶子必须为 状态标识｜简短名称｜[[路径#^编号块|CaseId]]，仅末尾编号可作为链接")
        stack.append(node)
    for node in nodes:
        if not node["leaf"] and not node["children"]:
            errors.append(f"{map_label}:{node['number']}: 分类节点没有用例子节点: {node['body']}")
    for case in cases:
        if case.case_id not in seen_ids:
            errors.append(f"{map_label}: 遗漏用例主叶子 {case.case_id}")
    return classifications, errors
