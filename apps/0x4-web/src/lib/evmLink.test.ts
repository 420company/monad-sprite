/**
 * @vitest-environment jsdom
 */
// 证明 EVM 地址的关联消息（lib/evmLink）与登录时顺带签名（lib/social loginWithWallet）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { verifyMessage } from 'viem'
import { evmLinkMessage, signEvmLink } from './evmLink'
import { loginWithWallet } from './social'
import { localSolanaWallet } from './vault/signers'

describe('EVM 地址关联消息', () => {
  it('格式写死（和服务端 server/tests/evmProof.test.ts 同一个样例，改了两边都要红）', () => {
    expect(evmLinkMessage('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', '0x42000005469Bb86210CC1c81b31fc457017ec000', 'a1b2c3d4e5f6a1b2c3d4e5f6')).toBe(
      '0x4 wallet link\ndomain: 420.meme\nsolana: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\nevm: 0x42000005469bb86210cc1c81b31fc457017ec000\nnonce: a1b2c3d4e5f6a1b2c3d4e5f6',
    )
  })

  it('EVM 地址大小写不影响消息；Solana 地址和 nonce 原样', () => {
    const a = evmLinkMessage('SoLAddr', '0xABCDEF0000000000000000000000000000000001', 'n1')
    expect(a).toBe(evmLinkMessage('SoLAddr', '0xabcdef0000000000000000000000000000000001', 'n1'))
    expect(a).not.toBe(evmLinkMessage('soladdr', '0xabcdef0000000000000000000000000000000001', 'n1'))
    expect(a).not.toBe(evmLinkMessage('SoLAddr', '0xabcdef0000000000000000000000000000000001', 'n2'))
  })

  it('signEvmLink 签的就是这条消息（EIP-191）', async () => {
    const acct = privateKeyToAccount(generatePrivateKey())
    const sig = await signEvmLink(acct, 'SolX', 'nonce123')
    expect(await verifyMessage({ address: acct.address, message: evmLinkMessage('SolX', acct.address, 'nonce123'), signature: sig })).toBe(true)
    expect(await verifyMessage({ address: acct.address, message: evmLinkMessage('SolY', acct.address, 'nonce123'), signature: sig })).toBe(false)
  })
})

describe('登录时顺带签 EVM', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** 拦下 fetch：nonce 接口回固定 nonce，verify 接口记下请求体 */
  function stubServer() {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (String(url).includes('/api/auth/nonce')) return json({ nonce: 'abc123', issuedAt: '2026-09-26T00:00:00.000Z', message: 'login-msg' })
      bodies.push(JSON.parse(String(init?.body)))
      return json({ token: 't', user: { address: 'x' } })
    }))
    return bodies
  }

  it('带已解锁的 EVM 账户：同一个 nonce 签关联消息一起提交', async () => {
    const bodies = stubServer()
    const sol = localSolanaWallet(Keypair.generate())
    const evm = privateKeyToAccount(generatePrivateKey())
    await loginWithWallet(sol, evm.address, evm)
    const b = bodies[0] as { evmAddress: string; evmSignature: `0x${string}`; address: string }
    expect(b.evmAddress).toBe(evm.address)
    expect(await verifyMessage({ address: evm.address, message: evmLinkMessage(sol.publicKey.toBase58(), evm.address, 'abc123'), signature: b.evmSignature })).toBe(true)
  })

  it('没有 EVM 账户（钱包锁着）或地址对不上：不带签名，照样登录', async () => {
    const bodies = stubServer()
    const sol = localSolanaWallet(Keypair.generate())
    const evm = privateKeyToAccount(generatePrivateKey())
    await loginWithWallet(sol, evm.address, null)
    await loginWithWallet(sol, evm.address, privateKeyToAccount(generatePrivateKey()))
    expect(bodies).toHaveLength(2)
    for (const b of bodies) { expect(b.evmSignature).toBeUndefined(); expect(b.evmAddress).toBe(evm.address) }
  })

  it('EVM 签名出错不挡登录', async () => {
    const bodies = stubServer()
    const sol = localSolanaWallet(Keypair.generate())
    const evm = privateKeyToAccount(generatePrivateKey())
    const broken = { ...evm, signMessage: async () => { throw new Error('用户取消') } }
    const r = await loginWithWallet(sol, evm.address, broken)
    expect(r.token).toBe('t')
    expect(bodies[0].evmSignature).toBeUndefined()
  })
})
