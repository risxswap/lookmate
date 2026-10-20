#!/usr/bin/env python3
"""从通过校验的中文用例和所需类型地图生成确定性的 v5 目录。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from _common import InputError, canonical_json, discover_markdown_files, file_sha256, load_cases, resolve_context


def build_catalog(input_path: Path, vault_root: Path | None = None,
                  api_map_path: Path | None = None,
                  ui_map_path: Path | None = None) -> tuple[Path, dict, list[str]]:
    context = resolve_context(input_path, vault_root, api_map_path, ui_map_path)
    cases_dir, cases, errors = load_cases(input_path, vault_root, api_map_path, ui_map_path)
    documents = [{"path": path.relative_to(cases_dir).as_posix(), "sha256": file_sha256(path)}
                 for path in discover_markdown_files(cases_dir, context.map_paths)]
    maps = [{"case_type": case_type,
             "path": context.map_for(case_type).relative_to(context.vault_root).as_posix(),
             "sha256": file_sha256(context.map_for(case_type))}
            for case_type in ("接口测试", "UI 集成测试") if context.map_for(case_type).is_file()]
    return cases_dir, {"schema_version": 5, "case_format": "chinese-markdown-v2",
                       "cases_root": cases_dir.relative_to(context.vault_root).as_posix(),
                       "maps": maps,
                       "documents": documents, "cases": [case.as_dict() for case in cases]}, errors


def catalog_directory(cases_dir: Path) -> Path:
    if cases_dir.name == "01-cases" and cases_dir.parent.name == "testing":
        return cases_dir.parent / "00-data" / "04-catalogs"
    for parent in (cases_dir, *cases_dir.parents):
        if parent.name == "testing":
            return parent / "00-data" / "04-catalogs"
    raise InputError("无法确定中间数据输出根；用例根须位于 testing 内")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="项目根、docs 目录、docs/testing 目录或完整用例根")
    parser.add_argument("--asset-root", "--vault-root", dest="vault_root", type=Path, help="资产根目录（--vault-root 为兼容别名）")
    parser.add_argument("--api-map", type=Path, help="接口测试全局地图文件")
    parser.add_argument("--ui-map", type=Path, help="UI 测试全局地图文件")
    parser.add_argument("--output", type=Path, help="输出路径，须位于 00-data/04-catalogs")
    args = parser.parse_args()
    try:
        context = resolve_context(args.path, args.vault_root, args.api_map, args.ui_map)
        cases_dir, catalog, errors = build_catalog(args.path, args.vault_root, args.api_map, args.ui_map)
        if errors:
            print(f"目录生成失败，共 {len(errors)} 个用例问题:", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 1
        output_root = catalog_directory(cases_dir).resolve()
        if context.testing_root is None or not output_root.is_relative_to(context.testing_root):
            raise InputError(f"中间数据目录越出所选项目边界: {output_root}")
        output = (args.output if args.output else output_root / "case-catalog.json").resolve()
        if not output.is_relative_to(output_root):
            raise InputError(f"目录输出路径必须位于: {output_root}")
        protected = {*context.map_paths,
                     *(file.resolve() for file in discover_markdown_files(cases_dir, context.map_paths))}
        if output in protected:
            raise InputError(f"不能覆盖源资产: {output}")
        if output.exists() and output.is_dir():
            raise InputError(f"输出路径是目录: {output}")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(canonical_json(catalog), encoding="utf-8")
    except (InputError, OSError, UnicodeError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2
    print(f"已生成 {output}: {len(catalog['cases'])} 条用例")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
