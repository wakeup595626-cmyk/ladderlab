import { describe, expect, it } from 'vitest'
import { parallelBranchOffsets } from './parallelLayout'

const metrics = {
  parallelGap: 8,
}

describe('parallelBranchOffsets', () => {
  it('uses the full row height for standard-height branches', () => {
    const offsets = parallelBranchOffsets(
      [{ height: 92 }, { height: 92 }, { height: 92 }],
      metrics,
    )

    expect(offsets).toEqual([0, 100, 200])
  })

  it('ignores the number of branches so six rows keep the two-row pitch', () => {
    const two = parallelBranchOffsets([{ height: 92 }, { height: 92 }], metrics)
    const six = parallelBranchOffsets(Array.from({ length: 6 }, () => ({ height: 92 })), metrics)

    expect(six.slice(1).map((value, index) => value - six[index])).toEqual([100, 100, 100, 100, 100])
    expect(six[1] - six[0]).toBe(two[1] - two[0])
  })

  it('only gives extra room to the taller branch in a mixed-height group', () => {
    const offsets = parallelBranchOffsets(
      [{ height: 92 }, { height: 176 }, { height: 92 }],
      metrics,
    )

    expect(offsets).toEqual([0, 100, 284])
  })

  it('lets the following row start after the tall branch ends', () => {
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

})
