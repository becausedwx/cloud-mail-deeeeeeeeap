export function redactDeploymentOutput(value) {
  return String(value ?? '').replace(/https?:\/\/[^\s]+/gi, '<redacted-url>')
}
