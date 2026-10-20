#!/usr/bin/env python3
"""Initialize testing assets under docs/testing in a target project."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from _common import MAP_SPECS


NUMBERED_DIRECTORIES = (
    "00-data",
    "00-data/01-sources",
    "00-data/01-sources/01-requirements",
    "00-data/01-sources/02-openapi",
    "00-data/02-analysis",
    "00-data/04-catalogs",
    "01-cases",
    "02-checks",
    "04-runs",
    "05-reports",
    "06-bugs",
    "06-bugs/01-pending-fix",
    "06-bugs/02-pending-verification",
    "06-bugs/03-verified",
)

UNSUPPORTED_ROOTS = ("data", "cases", "explorations", "plans", "runs", "reports", "bugs")


def initialize(project_root: Path, types: str = "all") -> tuple[list[Path], list[Path]]:
    if types not in {"api", "ui", "all"}:
        raise ValueError(f"未知测试类型: {types}")
    selected = tuple(key for key in MAP_SPECS if types == "all" or key == {"api": "接口测试", "ui": "UI 集成测试"}.get(types))
    project_root = project_root.resolve()
    if not project_root.is_dir():
        raise ValueError(f"目标项目目录不存在或不是目录: {project_root}")
    legacy_root = project_root / "testing"
    if legacy_root.exists() or legacy_root.is_symlink():
        raise ValueError(f"已有旧位置测试资产，不创建第二套目录；请先明确迁移安排: {legacy_root}")
    docs_root = project_root / "docs"
    if docs_root.is_symlink() or (docs_root.exists() and not docs_root.is_dir()):
        raise ValueError(f"文档目录目标冲突（包括软链接）: {docs_root}")
    testing_root = docs_root / "testing"
    if testing_root.exists() and not testing_root.is_dir():
        raise ValueError(f"目标已存在且不是目录: {testing_root}")
    if testing_root.is_symlink():
        raise ValueError(f"初始化不写入软链接测试根: {testing_root}")
    for relative in UNSUPPORTED_ROOTS:
        if (testing_root / relative).exists():
            raise ValueError(f"目标已有不受支持的未编号布局，不创建第二套目录: {relative}")
    targets = (tuple(testing_root / relative for relative in NUMBERED_DIRECTORIES)
               + tuple(testing_root / "01-cases" / Path(MAP_SPECS[key][0]).parent for key in selected)
               + (docs_root / "plan",))
    for target in targets:
        if target.is_symlink() or (target.exists() and not target.is_dir()):
            raise ValueError(f"目录目标冲突（包括软链接）: {target}")
    for relative in ("01-cases/api", "01-cases/ui-integration", "00-data/sources", "00-data/analysis", "00-data/catalogs"):
        if (testing_root / relative).exists():
            raise ValueError(f"目标包含不受支持的混合布局: {relative}")
    cases_root = testing_root / "01-cases"
    map_paths = tuple(cases_root / filename for filename, _ in MAP_SPECS.values())
    for map_path in map_paths:
        if map_path.is_symlink() or (map_path.exists() and not map_path.is_file()):
            raise ValueError(f"地图目标冲突（包括软链接）: {map_path}")
    existing_case_files = []
    if cases_root.exists():
        existing_case_files = [
            p for p in cases_root.rglob("*.md") if p.is_file() and p.resolve() not in {m.resolve() for m in map_paths}
        ]
    for case_type, (filename, _) in MAP_SPECS.items():
        type_dir = cases_root / Path(filename).parent
        if any(path.is_relative_to(type_dir) for path in existing_case_files) and not (cases_root / filename).is_file():
            raise ValueError(f"已有{case_type}用例但缺少全局地图；请先维护地图，初始化不会推导分类")
    candidates = []
    if testing_root.exists():
        for path in testing_root.rglob("*.md"):
            if not path.is_file() or not path.resolve().is_relative_to(testing_root):
                continue
            lines = path.read_text(encoding="utf-8").splitlines()
            if ("# 测试地图" in lines or "# 测试用例" in lines
                    or (lines[:3] == ["---", "mindmap-plugin: basic", "---"]
                        and any(title in lines[3:] for _, title in MAP_SPECS.values()))):
                candidates.append(path)
    if any(p.resolve() not in {m.resolve() for m in map_paths} for p in candidates):
        raise ValueError("已存在旧地图或额外地图；初始化对每个测试类型只维护一份全局地图")
    created, existing = [], []
    for target in targets:
        if target.exists():
            existing.append(target)
        else:
            target.mkdir(parents=True, exist_ok=False)
            created.append(target)
    for case_type, (filename, title) in MAP_SPECS.items():
        if case_type not in selected:
            continue
        map_path = cases_root / filename
        if map_path.exists():
            existing.append(map_path)
        else:
            with map_path.open("x", encoding="utf-8") as handle:
                handle.write(f"---\nmindmap-plugin: basic\n---\n\n{title}\n")
            created.append(map_path)
    return created, existing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_root", type=Path, help="已存在的目标项目目录")
    parser.add_argument("--types", choices=("api", "ui", "all"), default="all", help="初始化的测试类型，默认 all")
    args = parser.parse_args()
    try:
        created, existing = initialize(args.project_root, args.types)
    except (OSError, ValueError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2
    print(f"初始化完成: 新建 {len(created)} 项目录或文件，保留 {len(existing)} 项既有资产")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
