#!/usr/bin/env python3
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('    val root = project.extractDir.toPath().toAbsolutePath().normalize()\n    val relativeFiles = project.extractDir.walkTopDown()\n', '    val projectDir = File(project.extractDir)\n    val root = projectDir.toPath().toAbsolutePath().normalize()\n    val relativeFiles = projectDir.walkTopDown()\n')
s = s.replace('private fun copyUriToCache(context: Context, uri: Uri, prefix: String, suffix: String): File? = try {\n    val dir = File(context.cacheDir, "apk_builder_input").apply { mkdirs() }\n    val file = File(dir, "$prefix-${System.currentTimeMillis()}$suffix")\n    context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } } ?: return null\n    file.takeIf { it.isFile && it.length() > 0L }\n} catch (_: Exception) { null }\n', 'private fun copyUriToCache(context: Context, uri: Uri, prefix: String, suffix: String): File? {\n    return try {\n        val dir = File(context.cacheDir, "apk_builder_input").apply { mkdirs() }\n        val file = File(dir, "$prefix-${System.currentTimeMillis()}$suffix")\n        val input = context.contentResolver.openInputStream(uri) ?: return null\n        input.use { source -> file.outputStream().use { source.copyTo(it) } }\n        file.takeIf { it.isFile && it.length() > 0L }\n    } catch (_: Exception) { null }\n}\n')
p.write_text(s)
print('update script compatibility fixes applied')
