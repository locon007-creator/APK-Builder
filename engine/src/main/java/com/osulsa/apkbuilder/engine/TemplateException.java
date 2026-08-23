package com.osulsa.apkbuilder.engine;

public final class TemplateException extends Exception {
  private static final long serialVersionUID = 1L;
  private final TemplateErrorCode code;
  public TemplateException(TemplateErrorCode code, String message) { super(message); this.code = code; }
  public TemplateException(TemplateErrorCode code, String message, Throwable cause) { super(message, cause); this.code = code; }
  public TemplateErrorCode code() { return code; }
}
