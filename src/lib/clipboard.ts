/**
 * 复制文本到剪贴板。
 *
 * navigator.clipboard 只在安全上下文和用户手势里可用，微信内置浏览器、
 * 老版本 Edge 经常直接拒绝；所以失败时退回 execCommand，
 * 保证“生成链接”按钮不会在某些同学电脑上变成点了没反应。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到下面的兜底路径
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.left = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.focus()
    area.select()
    area.setSelectionRange(0, text.length)
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}
