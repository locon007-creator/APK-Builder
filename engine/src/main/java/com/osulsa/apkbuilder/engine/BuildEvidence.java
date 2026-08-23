package com.osulsa.apkbuilder.engine;

import java.time.Instant;

public record BuildEvidence(
    String buildId,
    String builderVersion,
    String templateVersion,
    String templateSha256,
    String inputSha256,
    String outputSha256,
    String signerCertificateSha256,
    String packageSkeleton,
    String alignmentResult,
    String signatureVerificationResult,
    Instant completedAt) {

  public String toJson() {
    return "{" +
        "\"buildId\":\"" + esc(buildId) + "\"," +
        "\"builderVersion\":\"" + esc(builderVersion) + "\"," +
        "\"templateVersion\":\"" + esc(templateVersion) + "\"," +
        "\"templateSha256\":\"" + esc(templateSha256) + "\"," +
        "\"inputSha256\":\"" + esc(inputSha256) + "\"," +
        "\"outputSha256\":\"" + esc(outputSha256) + "\"," +
        "\"signerCertificateSha256\":\"" + esc(signerCertificateSha256) + "\"," +
        "\"packageSkeleton\":\"" + esc(packageSkeleton) + "\"," +
        "\"alignmentResult\":\"" + esc(alignmentResult) + "\"," +
        "\"signatureVerificationResult\":\"" + esc(signatureVerificationResult) + "\"," +
        "\"completedAt\":\"" + completedAt + "\"}";
  }
  private static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }
}
