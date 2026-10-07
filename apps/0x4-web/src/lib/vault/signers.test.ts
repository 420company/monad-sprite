// Differential test for the native signing adapter layer.
//
// Here the native side is swapped for a "compute with a local key" stand-in, verifying that the two EIP-712 hashes the adapter computes itself
// match what viem signs directly. A wrongly-passed domain field once broke every contract signature in the app,
// while the UI only showed "temporarily unable to read the account" — so this must be guarded by a test.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, concatHex, type Hex } from 'viem'

const PK = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318' as Hex
const local = privateKeyToAccount(PK)

// The stand-in: native only does "prefix 0x1901 then sign", matching the signTypedData implementation in Swift
const signEvmTypedData = vi.fn(async ({ domainSeparator, structHash }: { domainSeparator: string; structHash: string }) => ({
  signature: await local.sign({ hash: keccak256(concatHex(['0x1901', domainSeparator as Hex, structHash as Hex])) }),
}))
const signEvmMessage = vi.fn(async ({ message }: { message: string }) => ({
  signature: await local.signMessage({ message: { raw: `0x${Buffer.from(message, 'base64').toString('hex')}` as Hex } }),
}))

vi.mock('@/lib/vault/native', () => ({
  Vault: { signEvmTypedData: (o: never) => signEvmTypedData(o), signEvmMessage: (o: never) => signEvmMessage(o) },
  nativeVault: true,
  b64: { fromBytes: (b: Uint8Array) => Buffer.from(b).toString('base64'), toBytes: (s: string) => new Uint8Array(Buffer.from(s, 'base64')) },
}))

const { nativeEvmAccount } = await import('./signers')

describe('原生 EVM 账户', () => {
  const account = nativeEvmAccount(local.address)
  beforeEach(() => { signEvmTypedData.mockClear(); signEvmMessage.mockClear() })

  it('签消息与 viem 一致', async () => {
    const message = '0x4 perp agent v2\n' + local.address.toLowerCase()
    expect(await account.signMessage!({ message })).toBe(await local.signMessage({ message }))
  })

  // The structure Aster management requests (approveAgent) actually use: 4 domain fields, business type included
  it('签 Aster 的 EIP-712 与 viem 一致', async () => {
    const typedData = {
      domain: { name: 'AsterSignTransaction', version: '1', chainId: 56, verifyingContract: '0x0000000000000000000000000000000000000000' as Hex },
      types: { ApproveAgent: [{ name: 'AgentAddress', type: 'address' }, { name: 'Nonce', type: 'uint256' }] },
      primaryType: 'ApproveAgent' as const,
      message: { AgentAddress: local.address, Nonce: 1758300000000n },
    }
    const got = await account.signTypedData!(typedData as never)
    expect(got).toBe(await local.signTypedData(typedData as never))
    expect(signEvmTypedData).toHaveBeenCalledTimes(1)
  })

  // Must also hash correctly with a partial domain (no verifyingContract)
  it('域字段缺省时也一致', async () => {
    const typedData = {
      domain: { name: 'Aster', version: '1', chainId: 1666 },
      types: { Message: [{ name: 'msg', type: 'string' }] },
      primaryType: 'Message' as const,
      message: { msg: 'symbol=BTCUSDT&side=BUY' },
    }
    expect(await account.signTypedData!(typedData as never)).toBe(await local.signTypedData(typedData as never))
  })
})
