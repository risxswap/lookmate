export function rememberDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
  for (const [unit, label] of [[86400, '天'], [3600, '小时'], [60, '分钟'], [1, '秒']] as const) {
    if (seconds % unit === 0) return `${seconds / unit} ${label}`;
  }
}
