package com.osulsa.apkbuilder.engine;

import java.util.List;

public record TemplateContract(
    int contractVersion,
    String templateVersion,
    String templateFile,
    String sha256,
    String minimumBuilderVersion,
    String packageSkeleton,
    List<String> requiredEntries,
    List<String> capabilities) {}
