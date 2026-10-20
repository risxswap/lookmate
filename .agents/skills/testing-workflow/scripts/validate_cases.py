#!/usr/bin/env python3
"""校验中文结构化用例、接口/UI 全局地图及 Obsidian 块链接。"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from _common import InputError, load_cases, resolve_context


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="项目根、docs 目录、docs/testing 目录或完整用例根")
    parser.add_argument("--asset-root", "--vault-root", dest="vault_root", type=Path, help="资产根目录（--vault-root 为兼容别名）")
    parser.add_argument("--api-map", type=Path, help="接口测试全局地图文件")
    parser.add_argument("--ui-map", type=Path, help="UI 测试全局地图文件")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出校验结果")
    args = parser.parse_args()
    try:
        context = resolve_context(args.path, args.vault_root, args.api_map, args.ui_map)
        cases_dir, cases, errors = load_cases(args.path, args.vault_root, args.api_map, args.ui_map)
    except (InputError, OSError, UnicodeError) as exc:
        if args.json:
            print(json.dumps({"valid": False, "case_count": 0, "errors": [str(exc)],
                              "asset_root": None, "vault_root": None, "map_paths": []}, ensure_ascii=False))
        else:
            print(f"错误: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps({"valid": not errors, "cases_dir": str(cases_dir), "case_count": len(cases),
                          "errors": errors, "map_paths": [str(path) for path in context.map_paths],
                          "asset_root": str(context.vault_root), "vault_root": str(context.vault_root)},
                         ensure_ascii=False, indent=2, sort_keys=True))
    elif errors:
        print(f"校验失败，共 {len(errors)} 个问题:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
    else:
        print(f"校验通过: {len(cases)} 条用例，目录 {cases_dir}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
