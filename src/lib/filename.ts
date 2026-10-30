/**
 * Windows 把 CON、NUL、COM1 这类名字当设备而不是文件：即使带上扩展名，
 * 例如 CON.ladderlab.json 也会被拒绝写入，学生只会看到一次“下载失败”。
 */
const WINDOWS_RESERVED_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * 导出文件名清洗：替换掉文件系统不接受的分隔符，空白折成连字符，
 * 并去掉结尾的点（Windows 会静默吞掉，实际落盘的名字和提示就对不上）。
 * 清洗后为空则回落到默认名，保证调用方总能拿到可用文件名。
 */
export function safeFileName(value: string): string {
  const collapsed = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.+$/, '')
  const base = collapsed || 'ladderlab-program'
  const reservedHead = base.split('.')[0] ?? ''
  return WINDOWS_RESERVED_BASENAME.test(reservedHead) ? base + '-file' : base
}
