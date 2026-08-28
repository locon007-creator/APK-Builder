#!/usr/bin/env python3
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

s = s.replace(
    'from pathlib import Path\nimport sys\n',
    'from pathlib import Path\nimport sys\nimport re\n',
    1,
)

old_version_patch = '''build_text = build.read_text()\nbuild_text = build_text.replace('versionCode = 311', 'versionCode = 500')\nbuild_text = build_text.replace('versionName = "3.1.1"', 'versionName = "5.0.0"')\nbuild.write_text(build_text)\n'''
new_version_patch = '''build_text = build.read_text()\nbuild_text, version_code_changes = re.subn(\n    r'(?m)^(\\s*)versionCode\\s*=\\s*\\d+\\s*$',\n    r'\\1versionCode = 501',\n    build_text,\n    count=1,\n)\nbuild_text, version_name_changes = re.subn(\n    r'(?m)^(\\s*)versionName\\s*=\\s*"[^"]+"\\s*$',\n    r'\\1versionName = "5.0.1"',\n    build_text,\n    count=1,\n)\nif version_code_changes != 1 or version_name_changes != 1:\n    raise SystemExit(\n        f'Could not set APK Builder 5.0.1 identity: versionCode={version_code_changes}, versionName={version_name_changes}'\n    )\nbuild.write_text(build_text)\n'''
if old_version_patch not in s:
    raise SystemExit('version patch compatibility target not found')
s = s.replace(old_version_patch, new_version_patch, 1)

s = s.replace(
    '    val root = project.extractDir.toPath().toAbsolutePath().normalize()\n    val relativeFiles = project.extractDir.walkTopDown()\n',
    '    val projectDir = File(project.extractDir)\n    val root = projectDir.toPath().toAbsolutePath().normalize()\n    val relativeFiles = projectDir.walkTopDown()\n',
    1,
)

s = s.replace(
    'private fun copyUriToCache(context: Context, uri: Uri, prefix: String, suffix: String): File? = try {\n'
    '    val dir = File(context.cacheDir, "apk_builder_input").apply { mkdirs() }\n'
    '    val file = File(dir, "$prefix-${System.currentTimeMillis()}$suffix")\n'
    '    context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } } ?: return null\n'
    '    file.takeIf { it.isFile && it.length() > 0L }\n'
    '} catch (_: Exception) { null }\n',
    'private fun copyUriToCache(context: Context, uri: Uri, prefix: String, suffix: String): File? {\n'
    '    return try {\n'
    '        val dir = File(context.cacheDir, "apk_builder_input").apply { mkdirs() }\n'
    '        val file = File(dir, "$prefix-${System.currentTimeMillis()}$suffix")\n'
    '        val input = context.contentResolver.openInputStream(uri) ?: return null\n'
    '        input.use { source -> file.outputStream().use { source.copyTo(it) } }\n'
    '        file.takeIf { it.isFile && it.length() > 0L }\n'
    '    } catch (_: Exception) { null }\n'
    '}\n',
    1,
)

p.write_text(s)
print('update script compatibility fixes applied')
