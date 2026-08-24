import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile


MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "package_web.py"
spec = importlib.util.spec_from_file_location("package_web", MODULE_PATH)
package_web = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(package_web)


class PackageWebTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        package_web.WORK_ROOT = self.root / ".work"
        package_web.ASSETS_ROOT = package_web.WORK_ROOT / "generated-assets"
        package_web.WEB_ROOT = package_web.ASSETS_ROOT / "www"

    def tearDown(self):
        self.temp.cleanup()

    def test_single_html_becomes_index(self):
        source = self.root / "hello.html"
        source.write_text("<h1>Hello</h1>", encoding="utf-8")

        package_web.import_project(source, None)

        output = package_web.WEB_ROOT / "index.html"
        self.assertTrue(output.is_file())
        self.assertEqual("<h1>Hello</h1>", output.read_text(encoding="utf-8"))

    def test_nested_zip_root_preserves_relative_assets(self):
        source = self.root / "site.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("project/index.html", "<script src='js/app.js'></script>")
            archive.writestr("project/js/app.js", "console.log('ok')")

        package_web.import_project(source, None)

        self.assertTrue((package_web.WEB_ROOT / "index.html").is_file())
        self.assertTrue((package_web.WEB_ROOT / "js" / "app.js").is_file())

    def test_zip_traversal_is_rejected(self):
        source = self.root / "unsafe.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("../escape.txt", "no")
            archive.writestr("index.html", "<p>unsafe</p>")

        with self.assertRaises(SystemExit):
            package_web.import_project(source, None)

    def test_shallowest_index_is_selected_deterministically(self):
        extracted = self.root / "extracted"
        (extracted / "app" / "nested").mkdir(parents=True)
        (extracted / "app" / "index.html").write_text("app", encoding="utf-8")
        (extracted / "app" / "nested" / "index.html").write_text("nested", encoding="utf-8")

        root = package_web.choose_entry_root(extracted, None)

        self.assertEqual(extracted / "app", root)


if __name__ == "__main__":
    unittest.main()
