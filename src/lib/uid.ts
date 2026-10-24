let counter = 0

export function uid(prefix = 'id'): string {
  counter += 1
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${random}${counter.toString(36)}`
}
