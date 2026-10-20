#!/usr/bin/env python3
"""Generate consistent Markdown and HTML reports from one run's JSON facts."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from _common import InputError
from _report import load_report_model, render_html, render_markdown


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="运行 manifest.json")
    parser.add_argument("--results", type=Path, required=True, help="运行 results.jsonl")
    parser.add_argument("--output-dir", type=Path, required=True, help="报告输出目录")
    args = parser.parse_args()
    try:
        manifest_path = args.manifest.resolve()
        results_path = args.results.resolve()
        output_dir = args.output_dir.resolve()
        if output_dir.exists() and not output_dir.is_dir():
            raise InputError(f"报告输出路径不是目录: {output_dir}")
        model = load_report_model(manifest_path, results_path)
        targets = [output_dir / "report.md", output_dir / "report.html"]
        protected = {manifest_path, results_path}
        protected.update((results_path.parent / (item if isinstance(item, str) else item["path"])).resolve()
                         for attempt in model.attempts for item in attempt["evidence"])
        for target in targets:
            if target.is_symlink() or target.resolve() in protected or (target.exists() and not target.is_file()):
                raise InputError(f"报告目标冲突，不能覆盖输入、证据或软链接: {target}")
        output_dir.mkdir(parents=True, exist_ok=True)
        markdown = render_markdown(model, results_path, output_dir)
        html = render_html(model, results_path, output_dir)
        (output_dir / "report.md").write_text(markdown, encoding="utf-8")
        (output_dir / "report.html").write_text(html, encoding="utf-8")
    except (InputError, OSError, UnicodeError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    print(f"已生成报告: {output_dir / 'report.md'} 和 {output_dir / 'report.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
