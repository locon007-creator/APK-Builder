package com.osulsa.apkbuilder.engine;

import java.nio.file.Path;

public record VerifiedTemplate(Path source, TemplateContract contract, String sha256) {}
