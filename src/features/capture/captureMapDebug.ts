export function isCaptureLocationMapDebugEnabled(isDevelopment: boolean, setting: string | undefined) {
  return isDevelopment && setting === 'true'
}
