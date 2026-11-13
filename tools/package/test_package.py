"""打包行为检查；应用构建使用隔离替身，不代替真实 Maven/npm 构建。"""

import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile


PROJECT = Path(__file__).resolve().parents[2]


class PackageBehaviorTest(unittest.TestCase):
    def setUp(self):
        self.sandbox = tempfile.TemporaryDirectory(prefix="lookmate-package-test-")
        self.root = Path(self.sandbox.name) / "project with spaces"
        self.root.mkdir()
        paths = [
            "package.sh", "tools/package.sh", "tools/package/README.md",
            "apps/server/docker-compose.yml", "apps/web/docker-compose.yml",
            "ops/docker-compose.yml", "ops/migrate-compose.sh",
            "infra/frp/docker-compose.yml", "infra/frp/frp.sh", "infra/frp/README.md",
            "infra/frp/.env.example", "infra/frp/config/frpc.toml", "infra/frp/config/frps.toml",
        ]
        for relative in paths:
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(PROJECT / relative, destination)
        for relative in ["apps/server/deploy", "apps/web/deploy", "ops/deploy"]:
            shutil.copytree(PROJECT / relative, self.root / relative)
        for component, config in [("mysql", "my.cnf"), ("redis", "redis.conf")]:
            for source_name, target_name in [
                ("docker-compose.prod.yml", "docker-compose.prod.yml"),
                (".env.prod.example", ".env.prod.example"),
                ("deploy/README.md", "deploy/README.md"),
                (f"config/{config}", f"config/{config}"),
            ]:
                destination = self.root / "infra" / component / target_name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(PROJECT / "infra" / component / source_name, destination)
        migrations = self.root / "ops/db/migrations"
        migrations.mkdir(parents=True)
        (migrations / "V1__fixture.sql").write_text("SELECT 1;\n")
        self.jar = self.root / "apps/server/target/lookmate-server.jar"
        self.jar.parent.mkdir()
        driver = io.BytesIO()
        with zipfile.ZipFile(driver, "w") as jar:
            jar.writestr("fixture.class", b"fixture driver")
        self.driver_bytes = driver.getvalue()
        with zipfile.ZipFile(self.jar, "w") as jar:
            jar.writestr("BOOT-INF/lib/mysql-connector-j-9.7.0.jar", self.driver_bytes)
            jar.writestr("META-INF/MANIFEST.MF", "Main-Class: fixture\n")
        self.dist = self.root / "apps/web/dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<html>fixture</html>")
        (self.dist / "assets/app.js").write_text("fixture")
        self.bin = self.root / "fake-jdk/bin"
        self.bin.mkdir(parents=True)
        self.make_executable(self.bin / "java", "#!/usr/bin/env bash\nprintf '    java.specification.version = 21\\n    java.home = %s\\n' \"$JAVA_HOME\" >&2\n")
        self.make_executable(self.bin / "jar", f"#!{sys.executable}\nimport sys, zipfile\nif sys.argv[1] == '--list':\n    with zipfile.ZipFile(sys.argv[3]) as jar: print('\\n'.join(jar.namelist()))\nelse:\n    with zipfile.ZipFile(sys.argv[2]) as jar: jar.extract(sys.argv[3])\n")
        self.make_executable(self.bin / "node", "#!/usr/bin/env bash\necho v24.22.0\n")
        self.make_executable(self.bin / "npm", "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$FAKE_NPM_LOG\"\n")
        self.make_executable(self.root / "apps/server/mvnw", "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$FAKE_MAVEN_LOG\"\n")
        self.environment = os.environ.copy()
        self.environment.update({
            "JAVA_HOME": str(self.bin.parent),
            "PATH": str(self.bin) + os.pathsep + self.environment["PATH"],
            "FAKE_MAVEN_LOG": str(self.root / "maven.log"),
            "FAKE_NPM_LOG": str(self.root / "npm.log"),
        })
        self.output = Path(self.sandbox.name) / "output with spaces"

    def tearDown(self):
        self.sandbox.cleanup()

    @staticmethod
    def make_executable(path, content):
        path.write_text(content)
        path.chmod(0o755)

    def run_package(self, *arguments, expect=0):
        result = subprocess.run(
            ["bash", str(self.root / "package.sh"), *arguments],
            cwd=self.sandbox.name, env=self.environment, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, expect, result.stdout + result.stderr)
        return result

    def package(self, target="all", version="release-1", expect=0):
        return self.run_package(target, "--version", version, "--output", str(self.output), expect=expect)

    def files(self):
        entries = {path.relative_to(self.output).as_posix(): path.read_bytes()
                   for path in self.output.rglob("*") if path.is_file()}
        self.assertFalse(any(name.endswith((".tar.gz", ".sha256")) for name in entries))
        self.assertFalse(any(name.startswith(("apps/", "infra/", "lookmate-")) for name in entries))
        for line in entries["SHA256SUMS"].decode().splitlines():
            digest, name = line.split(None, 1)
            self.assertEqual(digest, hashlib.sha256(entries[name.removeprefix("./")]).hexdigest())
        self.assertEqual(set(entries) - {"SHA256SUMS"}, {line.split(None, 1)[1].removeprefix("./") for line in entries["SHA256SUMS"].decode().splitlines()})
        return entries

    def assert_no_published_files(self):
        self.assertTrue(not self.output.exists() or not list(self.output.iterdir()))

    def test_help_and_invalid_arguments_do_not_create_output(self):
        self.run_package("--help")
        for args in [("unknown",), ("all", "web"), ("--version",), ("--version", "../escape"), ("--version", ""), ("--output", "")]:
            self.run_package(*args, expect=2)
        self.assertFalse((self.root / "output").exists())

    def test_all_package_checksums_whitelist_versions_and_driver(self):
        for relative in [".env.dev", "apps/server/.env", "apps/server/deploy/private.key", "ops/.env", "infra/mysql/data/private", "infra/frp/.env", "infra/frp/certs/private.key", "infra/frp/runtime/nginx.conf", "infra/frp/bin/frpc"]:
            path = self.root / relative
            path.parent.mkdir(exist_ok=True, parents=True)
            path.write_text("not-for-delivery")
        self.package()
        entries = self.files()
        self.assertEqual(entries["ops/drivers/mysql-connector-j-9.7.0.jar"], self.driver_bytes)
        self.assertEqual(entries["server/releases/release-1/lookmate-server.jar"], self.jar.read_bytes())
        self.assertIn("web/releases/release-1/dist/index.html", entries)
        self.assertTrue(all(b"not-for-delivery" not in content for content in entries.values()))
        self.assertIn(b"LOOKMATE_VERSION=release-1\n", entries["server/deploy/.env.example"])
        self.assertIn(b"LOOKMATE_VERSION=release-1\n", entries["web/deploy/.env.example"])
        self.assertIn(b"target=all\n", entries["BUILD-INFO.properties"])
        self.assertEqual((self.root / "maven.log").read_text(), "-B clean verify\n")
        self.assertEqual((self.root / "npm.log").read_text(), "ci\nrun build\n")
        self.assertEqual({path.name for path in self.output.iterdir()}, {"server", "web", "mysql", "redis", "frp", "ops", "README.md", "BUILD-INFO.properties", "SHA256SUMS"})
        self.assertEqual({name for name in entries if name.startswith("frp/")}, {
            "frp/docker-compose.yml", "frp/frp.sh", "frp/README.md", "frp/.env.example",
            "frp/config/frpc.toml", "frp/config/frps.toml",
        })
        self.assertTrue(os.access(self.output / "frp/frp.sh", os.X_OK))

    def test_infra_does_not_build_or_include_ops_and_uses_production_config(self):
        self.package("infra")
        entries = self.files()
        self.assertFalse((self.root / "maven.log").exists())
        self.assertFalse((self.root / "npm.log").exists())
        self.assertFalse(any(name.startswith(("ops/", "server/", "web/")) for name in entries))
        self.assertEqual(entries["mysql/docker-compose.yml"], (PROJECT / "infra/mysql/docker-compose.prod.yml").read_bytes())
        self.assertIn("redis/.env.example", entries)
        self.assertEqual(entries["frp/docker-compose.yml"], (PROJECT / "infra/frp/docker-compose.yml").read_bytes())
        self.assertIn("frp/config/frpc.toml", entries)
        self.assertIn("frp/config/frps.toml", entries)
        self.assertTrue(os.access(self.output / "frp/frp.sh", os.X_OK))
        self.assertEqual({p.name for p in self.output.iterdir() if p.is_dir()}, {"mysql", "redis", "frp"})

    def test_repeated_package_replaces_same_and_new_versions(self):
        self.package("infra")
        for version in ["release-1", "release-2"]:
            (self.output / "mysql/stale.txt").write_text("old")
            (self.output / "frp/stale.txt").write_text("old")
            self.package("infra", version=version)
            entries = self.files()
            self.assertNotIn("mysql/stale.txt", entries)
            self.assertNotIn("frp/stale.txt", entries)
            self.assertIn(f"version={version}\n".encode(), entries["BUILD-INFO.properties"])

    def test_default_output_preserves_unrelated_directories(self):
        self.output = self.root / "output"
        historical = self.output / "verification/evidence.txt"
        historical.parent.mkdir(parents=True)
        historical.write_text("old delivery")
        self.run_package("infra", "--version", "release-1")
        self.assertTrue((self.output / "mysql/docker-compose.yml").is_file())
        self.assertEqual(historical.read_text(), "old delivery")

    def test_server_and_web_targets_include_only_selected_components(self):
        for target, expected in [("server", {"server", "ops"}), ("web", {"web"})]:
            with self.subTest(target=target):
                self.output = Path(self.sandbox.name) / target
                self.package(target)
                self.files()
                self.assertEqual({p.name for p in self.output.iterdir() if p.is_dir()}, expected)

    def test_switching_target_clears_all_previous_components(self):
        self.package("all")
        self.package("web", version="release-2")
        entries = self.files()
        self.assertEqual({p.name for p in self.output.iterdir() if p.is_dir()}, {"web"})
        self.assertIn("web/releases/release-2/dist/index.html", entries)
        self.assertNotIn("web/releases/release-1/dist/index.html", entries)

    def test_cleanup_happens_before_build_and_failed_build_leaves_no_delivery(self):
        self.package()
        self.make_executable(self.root / "apps/server/mvnw", '''#!/usr/bin/env bash
for entry in server web mysql redis frp ops README.md BUILD-INFO.properties SHA256SUMS; do
  [[ ! -e "$EXPECTED_OUTPUT/$entry" ]] || exit 19
done
exit 9
''')
        self.environment["EXPECTED_OUTPUT"] = str(self.output)
        self.package(expect=9)
        self.assert_no_published_files()

    def test_invalid_arguments_and_toolchain_preserve_existing_delivery(self):
        self.package("infra")
        original = self.files()
        self.run_package("all", "--version", "../invalid", "--output", str(self.output), expect=2)
        self.assertEqual(original, self.files())
        self.make_executable(self.bin / "node", "#!/usr/bin/env bash\necho v25.8.1\n")
        self.package(expect=2)
        self.assertEqual(original, self.files())

    def test_cleanup_removes_legacy_deliveries_and_preserves_other_files(self):
        self.output.mkdir()
        legacy_names = ["lookmate-2026.11.12-all.tar.gz", "lookmate-2026.11.12-all.tar.gz.sha256", "lookmate-release-1-server"]
        for directory in [self.output, self.output / "packages"]:
            directory.mkdir(exist_ok=True)
            for name in legacy_names:
                path = directory / name
                if name.endswith("server"):
                    path.mkdir()
                    (path / "old.jar").write_text("old")
                else:
                    path.write_text("old")
        kept = self.output / "packages/notes.txt"
        kept.write_text("keep")
        self.package("infra")
        for directory in [self.output, self.output / "packages"]:
            self.assertFalse(any(directory.glob("lookmate-*")))
        self.assertEqual(kept.read_text(), "keep")

    def test_cleanup_unlinks_delivery_links_without_removing_targets(self):
        external = Path(self.sandbox.name) / "external"
        external.mkdir()
        original = external / "keep.txt"
        original.write_text("keep")
        self.output.mkdir()
        for name in ["server", "web", "mysql", "redis", "frp", "ops", "packages"]:
            (self.output / name).symlink_to(external, target_is_directory=True)
        (self.output / "README.md").symlink_to(original)
        self.package("infra")
        self.assertEqual(original.read_text(), "keep")
        self.files()

    def test_dangerous_output_directories_are_rejected_before_cleanup(self):
        for output in [self.root, self.root.parent, Path("/"), *[self.root / name for name in ["apps", "infra", "ops", "tools", "docs", ".git", ".agents", ".codex"]]]:
            with self.subTest(output=output):
                output.mkdir(exist_ok=True)
                original_readme = (self.root / "README.md")
                original_readme.write_text("keep project")
                self.run_package("infra", "--output", str(output), expect=2)
                self.assertEqual(original_readme.read_text(), "keep project")
        alias = Path(self.sandbox.name) / "source-alias"
        alias.symlink_to(self.root / "apps", target_is_directory=True)
        self.run_package("infra", "--output", str(alias), expect=2)

    def test_output_lock_preserves_existing_delivery(self):
        self.package("infra")
        original = self.files()
        lock = self.output / ".lookmate-package.lock"
        lock.mkdir()
        self.package("web", expect=2)
        self.assertEqual(original, self.files())
        self.assertTrue(lock.is_dir())

    def test_publication_failure_removes_only_current_delivery(self):
        self.output.mkdir()
        historical = self.output / "historical.txt"
        historical.write_text("keep")
        real_cp = shutil.which("cp")
        self.make_executable(self.bin / "cp", f'''#!/usr/bin/env bash
if [[ "$*" == *"{self.output}/redis/"* ]]; then exit 17; fi
exec "{real_cp}" "$@"
''')
        self.package("infra", expect=17)
        self.assertEqual(list(self.output.iterdir()), [historical])
        self.assertEqual(historical.read_text(), "keep")

    def test_metadata_publication_failure_removes_owned_files(self):
        real_ln = shutil.which("ln")
        self.make_executable(self.bin / "ln", f'''#!/usr/bin/env bash
if [[ "$*" == *"BUILD-INFO.properties"* ]]; then exit 18; fi
exec "{real_ln}" "$@"
''')
        self.package("infra", expect=18)
        self.assert_no_published_files()

    def test_output_lock_rejects_concurrent_publication(self):
        lock = self.output / ".lookmate-package.lock"
        lock.mkdir(parents=True)
        self.package("infra", expect=2)
        self.assertEqual(list(self.output.iterdir()), [lock])

    def test_failed_build_leaves_no_package_or_temporary_files(self):
        self.make_executable(self.root / "apps/server/mvnw", "#!/usr/bin/env bash\nexit 9\n")
        self.package(expect=9)
        self.assert_no_published_files()

    def test_all_preflights_node_before_starting_maven(self):
        self.make_executable(self.bin / "node", "#!/usr/bin/env bash\necho v25.8.1\n")
        self.package(expect=2)
        self.assertFalse((self.root / "maven.log").exists())
        self.assertFalse((self.root / "npm.log").exists())
        self.assert_no_published_files()

    def test_missing_driver_fails_before_publishing(self):
        with zipfile.ZipFile(self.jar, "w") as jar:
            jar.writestr("META-INF/MANIFEST.MF", "fixture")
        self.package("server", expect=2)
        self.assert_no_published_files()

    def test_web_rejects_symlink_and_private_file(self):
        link = self.dist / "assets/leak.js"
        link.symlink_to(self.root / "package.sh")
        self.package("web", expect=2)
        self.assert_no_published_files()
        link.unlink()
        (self.dist / ".env.dev").write_text("fixture-secret")
        self.package("web", expect=2)
        self.assert_no_published_files()


if __name__ == "__main__":
    unittest.main(verbosity=2)
