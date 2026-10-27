import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FAVORITE_INSTRUCTIONS,
  FAVORITE_INSTRUCTIONS_STORAGE_KEY,
  MAX_FAVORITE_INSTRUCTIONS,
  favoriteInstructionId,
  readFavoriteInstructions,
  toggleFavoriteInstruction,
  writeFavoriteInstructions,
} from './instructionFavorites'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

/** 十种确实存在于指令目录里的 id，用来验证 8 项上限。 */
const TEN_VALID_IDS = [
  'contact:NO',
  'contact:NC',
  'contact:P',
  'contact:N',
  'contact:CMP',
  'output:COIL',
  'output:SET',
  'output:RESET',
  'output:TON',
  'output:TOF',
]

let storage: MemoryStorage

function store(raw: string): void {
  storage.setItem(FAVORITE_INSTRUCTIONS_STORAGE_KEY, raw)
}

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('instruction favorites', () => {
  it('starts with the five common instructions when nothing is stored', () => {
    expect(readFavoriteInstructions()).toEqual([
      'contact:NO',
      'contact:NC',
      'output:COIL',
      'output:TON',
      'contact:CMP',
    ])
    expect(readFavoriteInstructions()).toEqual([...DEFAULT_FAVORITE_INSTRUCTIONS])
  })

  it('builds ids as family:kind and keeps the catalog spelling', () => {
    expect(favoriteInstructionId('contact', 'NO')).toBe('contact:NO')
    expect(favoriteInstructionId('output', 'TON')).toBe('output:TON')
  })

  it('falls back to the defaults when the stored JSON is broken', () => {
    store('{"favorites":[')
    expect(readFavoriteInstructions()).toEqual([...DEFAULT_FAVORITE_INSTRUCTIONS])
  })

  it('falls back to the defaults when the stored value is not an array', () => {
    store('{"favorites":["contact:NO"]}')
    expect(readFavoriteInstructions()).toEqual([...DEFAULT_FAVORITE_INSTRUCTIONS])

    store('"contact:NO"')
    expect(readFavoriteInstructions()).toEqual([...DEFAULT_FAVORITE_INSTRUCTIONS])

    store('null')
    expect(readFavoriteInstructions()).toEqual([...DEFAULT_FAVORITE_INSTRUCTIONS])
  })

  it('drops unknown entries, duplicates and non-strings while keeping order', () => {
    store(
      JSON.stringify([
        'output:TON',
        'contact:NO',
        'contact:NO',
        'contact:UNKNOWN',
        'output:',
        '',
        42,
        null,
        { family: 'contact' },
        'output:COIL',
      ]),
    )

    expect(readFavoriteInstructions()).toEqual(['output:TON', 'contact:NO', 'output:COIL'])
  })

  it('keeps an explicitly emptied list empty', () => {
    store('[]')
    expect(readFavoriteInstructions()).toEqual([])
  })

  it('truncates to the maximum of eight favorites', () => {
    store(JSON.stringify(TEN_VALID_IDS))

    const favorites = readFavoriteInstructions()
    expect(favorites).toHaveLength(MAX_FAVORITE_INSTRUCTIONS)
    expect(favorites).toEqual(TEN_VALID_IDS.slice(0, MAX_FAVORITE_INSTRUCTIONS))
  })

  it('round-trips a written list and sanitizes it on the way out', () => {
    writeFavoriteInstructions(['output:TON', 'contact:NO', 'contact:NO', 'nope:NADA'])
    expect(readFavoriteInstructions()).toEqual(['output:TON', 'contact:NO'])
  })

  it('refuses to store more than the maximum', () => {
    writeFavoriteInstructions(TEN_VALID_IDS)
    expect(JSON.parse(storage.getItem(FAVORITE_INSTRUCTIONS_STORAGE_KEY) ?? '[]')).toEqual(
      TEN_VALID_IDS.slice(0, MAX_FAVORITE_INSTRUCTIONS),
    )
  })

  it('stays silent when storage rejects the write', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => writeFavoriteInstructions(['contact:NO'])).not.toThrow()
  })

  it('falls back to the defaults when storage cannot be read', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(readFavoriteInstructions()).toEqual([...DEFAULT_FAVORITE_INSTRUCTIONS])
  })

  it('toggles a favorite on and off without reordering the rest', () => {
    const added = toggleFavoriteInstruction(['contact:NO'], 'output', 'TOF')
    expect(added).toEqual(['contact:NO', 'output:TOF'])

    const removed = toggleFavoriteInstruction(added, 'contact', 'NO')
    expect(removed).toEqual(['output:TOF'])
  })

  it('ignores instructions that are not in the catalog', () => {
    expect(toggleFavoriteInstruction(['contact:NO'], 'contact', 'NOPE' as never)).toEqual([
      'contact:NO',
    ])
  })

  it('keeps the list unchanged when the maximum is reached', () => {
    const full = TEN_VALID_IDS.slice(0, MAX_FAVORITE_INSTRUCTIONS)
    expect(full).not.toContain('output:TON')
    expect(toggleFavoriteInstruction(full, 'output', 'TON')).toEqual(full)
  })
})
