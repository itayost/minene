import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'

const projectRoot = process.cwd()

describe('validate:brands', () => {
  test('succeeds when the brand registry is empty', () => {
    const result = spawnSync('pnpm', ['validate:brands'], {
      cwd: projectRoot,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
  })
})
