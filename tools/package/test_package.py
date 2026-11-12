"""打包行为检查；应用构建使用隔离替身，不代替真实 Maven/npm 构建。"""

import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
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

    def files(self, target="all", version="release-1"):
        archive = self.output / f"lookmate-{version}-{target}.tar.gz"
        with tarfile.open(archive) as package:
            entries = {member.name.split("/", 1)[1]: package.extractfile(member).read()
                       for member in package.getmembers() if member.isfile()}
            self.assertFalse(any("/._" in member.name for member in package.getmembers()))
        external = Path(str(archive) + ".sha256").read_text().split()[0]
        self.assertEqual(external, hashlib.sha256(archive.read_bytes()).hexdigest())
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
        for relative in [".env.dev", "apps/server/.env", "apps/server/deploy/private.key", "ops/.env", "infra/mysql/data/private"]:
            path = self.root / relative
            path.parent.mkdir(exist_ok=True, parents=True)
            path.write_text("not-for-delivery")
        self.package()
        entries = self.files()
        self.assertEqual(entries["ops/drivers/mysql-connector-j-9.7.0.jar"], self.driver_bytes)
        self.assertEqual(entries["apps/server/releases/release-1/lookmate-server.jar"], self.jar.read_bytes())
        self.assertIn("apps/web/releases/release-1/dist/index.html", entries)
        self.assertTrue(all(b"not-for-delivery" not in content for content in entries.values()))
        self.assertIn(b"LOOKMATE_VERSION=release-1\n", entries["apps/server/deploy/.env.example"])
        self.assertIn(b"LOOKMATE_VERSION=release-1\n", entries["apps/web/deploy/.env.example"])
        self.assertIn(b"target=all\n", entries["BUILD-INFO.properties"])
        self.assertEqual((self.root / "maven.log").read_text(), "-B clean verify\n")
        self.assertEqual((self.root / "npm.log").read_text(), "ci\nrun build\n")
        self.assertEqual(sorted(path.suffix for path in self.output.iterdir()), [".gz", ".sha256"])

    def test_infra_does_not_build_or_include_ops_and_uses_production_config(self):
        self.package("infra")
        entries = self.files("infra")
        self.assertFalse((self.root / "maven.log").exists())
        self.assertFalse((self.root / "npm.log").exists())
        self.assertFalse(any(name.startswith(("ops/", "apps/")) for name in entries))
        self.assertEqual(entries["infra/mysql/docker-compose.yml"], (PROJECT / "infra/mysql/docker-compose.prod.yml").read_bytes())
        self.assertIn("infra/redis/.env.example", entries)

    def test_same_version_is_rejected_without_changing_existing_files(self):
        self.package("infra")
        original = {path.name: path.read_bytes() for path in self.output.iterdir()}
        self.package("infra", expect=2)
        self.assertEqual(original, {path.name: path.read_bytes() for path in self.output.iterdir()})

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
