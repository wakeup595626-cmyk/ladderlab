import { describe, expect, it } from 'vitest'
import {
  compactContactHitHeight,
  hasCompactParallelPitch,
  parallelBranchOffsets,
} from './parallelLayout'

const metrics = {
  contactH: 92,
  parallelGap: 8,
  parallelPitch: 67,
}

describe('parallelBranchOffsets', () => {
  it('uses the compressed pitch for standard-height branches', () => {
    const offsets = parallelBranchOffsets(
      [{ height: 92 }, { height: 92 }, { height: 92 }],
      metrics,
    )

    expect(offsets).toEqual([0, 67, 134])
  })

  it('measures mixed layouts from the previous branch height', () => {
    const offsets = parallelBranchOffsets(
      [{ height: 92 }, { height: 176 }, { height: 92 }],
      metrics,
    )

    expect(offsets).toEqual([0, 100, 284])
  })

  it('does not collapse a tall first branch into the next branch', () => {
    const offsets = parallelBranchOffsets(
      [{ height: 176 }, { height: 92 }],
      metrics,
    )

    expect(offsets).toEqual([0, 184])
  })

  it('handles an empty or single branch safely', () => {
    expect(parallelBranchOffsets([], metrics)).toEqual([])
    expect(parallelBranchOffsets([{ height: 176 }], metrics)).toEqual([0])
  })

  it('keeps compact hit targets large enough but inside their own branch row', () => {
    expect(hasCompactParallelPitch([{ height: 92 }, { height: 92 }], metrics)).toBe(true)
    expect(hasCompactParallelPitch([{ height: 92 }, { height: 176 }], metrics)).toBe(false)
    expect(compactContactHitHeight(metrics)).toBe(65)
    expect(compactContactHitHeight({ ...metrics, parallelPitch: 65 })).toBe(63)
    expect(compactContactHitHeight({ ...metrics, parallelPitch: 40 })).toBe(44)
  })
})
