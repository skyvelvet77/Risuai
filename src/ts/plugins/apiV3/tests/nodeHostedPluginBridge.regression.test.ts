import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const factorySource = readFileSync(resolve(repoRoot, 'src/ts/plugins/apiV3/factory.ts'), 'utf8')
const globalApiSource = readFileSync(resolve(repoRoot, 'src/ts/globalApi.svelte.ts'), 'utf8')

describe('node-hosted V3 plugin bridge regressions', () => {
  test('guest bridge transfers stream bodies back to the host', () => {
    const guestCollectTransferables = factorySource.match(/function collectTransferables\(obj, transferables = \[\]\) \{[\s\S]*?return transferables;\n    \}/)

    expect(guestCollectTransferables?.[0]).toContain('obj instanceof ReadableStream')
    expect(guestCollectTransferables?.[0]).toContain('obj instanceof WritableStream')
    expect(guestCollectTransferables?.[0]).toContain('obj instanceof TransformStream')
  })

  test('fetchNative routes node-hosted requests through the local /proxy2 endpoint by default', () => {
    expect(globalApiSource).toMatch(/let throughProxy = \(!isTauri\) && \(!db\.usePlainFetch\)/)
    expect(globalApiSource).toMatch(/const proxyUrl = !isTauri && !isNodeServer \? hubURL \+ `\/proxy2` : `\/proxy2`/)
    expect(globalApiSource).toMatch(/const r = await fetch\(proxyUrl, \{/)
  })
})
