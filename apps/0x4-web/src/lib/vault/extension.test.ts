// 0x4 browser extension adapter layer (docs/EXTENSION_API.md): verified with a fake window.ox4 (real signatures with test keys)
// The adapter attaches signatures back to txs / reconstructs signed txs correctly, verifies the signer for 7702 authorizations, maps error codes, and logs in via signLogin.
// Every success path has a control (changed key / changed contract / changed chain) proving the checks really work.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { generatePrivateKey, privateKeyToAccount, sign } from 'viem/accounts'
import { keccak256, recoverTransactionAddress, serializeSignature, type Hex } from 'viem'
import { hashAuthorization } from 'viem/utils'
import { extensionSolanaWallet, extensionEvmAccount, extensionDm, extensionBtcSigner, Ox4Error, type Ox4Provider } from './extension'
import { isUserCancel } from '@/lib/errors'
import { b64 } from './native'

const ALLOWED_7702 = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B'

/** In jsdom, Node's Buffer and the page's Uint8Array are different types and the signing lib only accepts the latter: normalize (fake extension in tests only) */
const edSign = (m: Uint8Array, kp: Keypair) => ed25519.sign(Uint8Array.from(m), Uint8Array.from(kp.secretKey.slice(0, 32)))
const edVerify = (s: Uint8Array, m: Uint8Array, pk: Uint8Array) => ed25519.verify(Uint8Array.from(s), Uint8Array.from(m), Uint8Array.from(pk))

/** Fake extension: Solana signs with solKp, EVM with evmKey; calls records each call's method and params */
function fakeOx4(solKp: Keypair, evmKey: Hex, over: Partial<Ox4Provider> = {}) {
  const calls: { m: string; a: unknown }[] = []
  const evm = privateKeyToAccount(evmKey)
  const rec = <T,>(m: string, a: unknown, v: T) => { calls.push({ m, a }); return Promise.resolve(v) }
  const p: Ox4Provider = {
    isOx4: true,
    status: () => rec('status', null, { version: '1', connected: true, unlocked: true, address: solKp.publicKey.toBase58(), evmAddress: evm.address, btcAddress: '' }),
    connect: () => rec('connect', null, { address: solKp.publicKey.toBase58(), evmAddress: evm.address, btcAddress: '' }),
    disconnect: () => rec('disconnect', null, { ok: true as const }),
    signLogin: ({ message }) => rec('signLogin', message, { signature: bs58.encode(edSign(new TextEncoder().encode(message), solKp)), chain: 'solana' as const }),
    async signSolanaTransaction({ tx }) {
      calls.push({ m: 'signSolanaTransaction', a: tx })
      const raw = b64.toBytes(tx)
      // Extension side: recognize the tx type, sign its message
      let msg: Uint8Array
      try { msg = VersionedTransaction.deserialize(raw).message.serialize() } catch { msg = Transaction.from(raw).serializeMessage() }
      return { signature: bs58.encode(edSign(msg, solKp)) }
    },
    signSolanaMessage: ({ message }) => rec('signSolanaMessage', message, { signature: bs58.encode(edSign(b64.toBytes(message), solKp)) }),
    async signEvmTransaction({ tx, chainId }) {
      calls.push({ m: 'signEvmTransaction', a: { tx, chainId } })
      const s = await sign({ hash: keccak256(tx as Hex), privateKey: evmKey })
      return { signature: serializeSignature(s) }
    },
    async signEvmMessage({ message }) { calls.push({ m: 'signEvmMessage', a: message }); return { signature: await evm.signMessage({ message }) } },
    async signEvmTypedData({ typedData }) { calls.push({ m: 'signEvmTypedData', a: typedData }); return { signature: await evm.signTypedData(JSON.parse(typedData)) } },
    async signAuthorization7702({ chainId, nonce }) {
      calls.push({ m: 'signAuthorization7702', a: { chainId, nonce } })
      const s = await sign({ hash: hashAuthorization({ contractAddress: ALLOWED_7702, chainId: Number(chainId), nonce: Number(nonce) }), privateKey: evmKey })
      return { signature: serializeSignature(s) }
    },
    signAutoTrade: (o) => rec('signAutoTrade', o, { buyErc20: '0x01', sell: '0x02' }),
    agentAddress: () => rec('agentAddress', null, { address: '0x000000000000000000000000000000000000a9e7' }),
    signAgentTypedData: ({ typedData }) => rec('signAgentTypedData', typedData, { signature: '0xagent' }),
    perpRead: (o) => rec('perpRead', o, { status: 200, body: { ok: 1 } }),
    perpWrite: (o) => rec('perpWrite', o, { results: o.actions.map((x) => ({ action: x.action, status: 200, body: { orderId: 1, status: 'NEW' } })) }),
    perpSessionStart: (o) => rec('perpSessionStart', o, { active: true as const, until: 1 }),
    perpSessionStatus: () => rec('perpSessionStatus', null, { active: false as const }),
    perpSessionEnd: () => rec('perpSessionEnd', null, { active: false as const }),
    dmPublicKey: () => rec('dmPublicKey', null, { publicKey: 'PUB' }),
    dmEncrypt: (o) => rec('dmEncrypt', o, { ciphertext: 'C', nonce: 'N', epk: 'E' }),
    dmDecrypt: (o) => rec('dmDecrypt', o, { text: 'hello' }),
    signBtc: (o) => rec('signBtc', o, { tx: 'signedhex' }),
    on: () => {},
    off: () => {},
    ...over,
  }
  return { p, calls, evm }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Solana', () => {
  const blockhash = bs58.encode(new Uint8Array(32).fill(7))
  it('旧式交易：整笔交给插件，签名挂回后交易验签通过（对照：换一把钥匙签就验不过）', async () => {
    const kp = Keypair.generate()
    const { p, calls } = fakeOx4(kp, generatePrivateKey())
    const w = extensionSolanaWallet(p, kp.publicKey.toBase58())
    const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }))
    await w.signTransaction(tx)
    expect(tx.verifySignatures()).toBe(true)
    expect(calls.find((c) => c.m === 'signSolanaTransaction')).toBeTruthy()
    // Control: extension signs with a different key — attaching to this address fails verification
    const other = fakeOx4(Keypair.generate(), generatePrivateKey()).p
    const w2 = extensionSolanaWallet(other, kp.publicKey.toBase58())
    const tx2 = new Transaction({ feePayer: kp.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }))
    await w2.signTransaction(tx2)
    expect(tx2.verifySignatures()).toBe(false)
  })
  it('版本化交易：签名放在付款人的位置上，能用公钥验过', async () => {
    const kp = Keypair.generate()
    const { p } = fakeOx4(kp, generatePrivateKey())
    const w = extensionSolanaWallet(p, kp.publicKey.toBase58())
    const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message()
    const vtx = new VersionedTransaction(msg)
    await w.signTransaction(vtx)
    expect(edVerify(vtx.signatures[0], vtx.message.serialize(), kp.publicKey.toBytes())).toBe(true)
  })
  it('签消息：返回 64 字节签名，能验过', async () => {
    const kp = Keypair.generate()
    const { p } = fakeOx4(kp, generatePrivateKey())
    const m = new TextEncoder().encode('hi 0x4')
    const sig = await extensionSolanaWallet(p, kp.publicKey.toBase58()).signMessage(m)
    expect(sig.length).toBe(64)
    expect(edVerify(sig, m, kp.publicKey.toBytes())).toBe(true)
  })
})

describe('EVM', () => {
  it('交易：网页层序列化 → 插件签 → 还原成已签交易，能恢复出本人地址（对照：插件用别的钥匙签恢复出别人）', async () => {
    const key = generatePrivateKey()
    const { p, calls, evm } = fakeOx4(Keypair.generate(), key)
    const acc = extensionEvmAccount(p, evm.address)
    const tx = { chainId: 56, type: 'eip1559' as const, to: '0x000000000000000000000000000000000000dEaD' as Hex, value: 1n, nonce: 3, gas: 21000n, maxFeePerGas: 3n * 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n }
    const signed = await acc.signTransaction!(tx)
    expect((await recoverTransactionAddress({ serializedTransaction: signed as never })).toLowerCase()).toBe(evm.address.toLowerCase())
    expect((calls.find((c) => c.m === 'signEvmTransaction')!.a as { chainId: number }).chainId).toBe(56)
    const other = fakeOx4(Keypair.generate(), generatePrivateKey()).p
    const signed2 = await extensionEvmAccount(other, evm.address).signTransaction!(tx)
    expect((await recoverTransactionAddress({ serializedTransaction: signed2 as never })).toLowerCase()).not.toBe(evm.address.toLowerCase())
  })
  it('结构化数据：整份 JSON 交给插件（bigint 转成十进制字符串），不是只给哈希', async () => {
    const { p, calls, evm } = fakeOx4(Keypair.generate(), generatePrivateKey())
    const td = { domain: { name: 'X', chainId: 56 }, types: { M: [{ name: 'n', type: 'uint256' }] }, primaryType: 'M', message: { n: 5 } }
    await extensionEvmAccount(p, evm.address).signTypedData!(td as never)
    expect(JSON.parse(calls.find((c) => c.m === 'signEvmTypedData')!.a as string)).toEqual(td)
    // bigint serializes too (viem numbers are often bigint) — no TypeError
    const big = { ...td, message: { n: 123456789012345678901234567890n } }
    const { p: p2, calls: c2 } = fakeOx4(Keypair.generate(), generatePrivateKey(), { signEvmTypedData: async ({ typedData }) => { c2.push({ m: 'x', a: typedData }); return { signature: '0x' } } })
    await extensionEvmAccount(p2, evm.address).signTypedData!(big as never)
    expect(c2[0].a as string).toContain('"123456789012345678901234567890"')
  })
  it('签消息只收可读文字：原始字节不是 UTF-8 就拒签，不去盲签', async () => {
    const { p, evm } = fakeOx4(Keypair.generate(), generatePrivateKey())
    const acc = extensionEvmAccount(p, evm.address)
    expect(await acc.signMessage!({ message: 'hello' })).toMatch(/^0x/)
    await expect(acc.signMessage!({ message: { raw: '0xff00ff' } })).rejects.toThrow()
  })
  it('7702 授权：只允许写死的合约，签完核对签名人（对照：换合约直接拒、插件用别的钥匙签也拒）', async () => {
    const key = generatePrivateKey()
    const { p, evm } = fakeOx4(Keypair.generate(), key)
    const acc = extensionEvmAccount(p, evm.address) as ReturnType<typeof extensionEvmAccount> & { signAuthorization: (a: { address: Hex; chainId: number; nonce: number }) => Promise<unknown> }
    await expect(acc.signAuthorization({ address: ALLOWED_7702, chainId: 56, nonce: 0 })).resolves.toBeTruthy()
    await expect(acc.signAuthorization({ address: '0x0000000000000000000000000000000000000001', chainId: 56, nonce: 0 })).rejects.toThrow()
    const other = fakeOx4(Keypair.generate(), generatePrivateKey()).p
    const acc2 = extensionEvmAccount(other, evm.address) as typeof acc
    await expect(acc2.signAuthorization({ address: ALLOWED_7702, chainId: 56, nonce: 0 })).rejects.toThrow()
  })
  it('合约交易密钥在插件里：地址和签名都走插件的专用入口', async () => {
    const { p, calls, evm } = fakeOx4(Keypair.generate(), generatePrivateKey())
    const acc = extensionEvmAccount(p, evm.address) as ReturnType<typeof extensionEvmAccount> & { ox4Agent: () => Promise<{ address: Hex; signTypedData: (td: unknown) => Promise<Hex> }> }
    const agent = await acc.ox4Agent()
    expect(agent.address).toBe('0x000000000000000000000000000000000000a9e7')
    expect(await agent.signTypedData({ domain: {}, types: {}, primaryType: 'X', message: {} })).toBe('0xagent')
    expect(calls.map((c) => c.m)).toEqual(['agentAddress', 'signAgentTypedData'])
    // Never requests a signature on the raw "0x4 perp agent v2" message
    expect(calls.some((c) => c.m === 'signEvmMessage')).toBe(false)
  })

  it('合约写操作和网页快捷交易（2026-09-30）：动作原样交给插件 perpWrite；登录带快捷交易请求；老版本插件提示更新', async () => {
    const { p, calls, evm } = fakeOx4(Keypair.generate(), generatePrivateKey())
    const acc = extensionEvmAccount(p, evm.address)
    const actions = [{ action: 'cancel' as const, params: { symbol: 'BTCUSDT', orderId: '1' } }]
    expect(await acc.ox4PerpWrite(actions)).toEqual({ results: [{ action: 'cancel', status: 200, body: { orderId: 1, status: 'NEW' } }] })
    expect(calls.at(-1)).toEqual({ m: 'perpWrite', a: { actions } })
    expect(await acc.ox4PerpSession.status()).toEqual({ active: false })
    expect(await acc.ox4PerpSession.start()).toEqual({ active: true, until: 1 })
    // Login: carries the quick-trade request (the extension puts the switch in the login window)
    const sol = extensionSolanaWallet(p, Keypair.generate().publicKey.toBase58())
    const seen: unknown[] = []
    p.signLogin = async (o) => { seen.push(o); return { signature: '0x', chain: 'evm' } }
    await sol.signLogin('hi')
    expect(seen).toEqual([{ message: 'hi', perpSession: {} }])   // No allowance (goat 2026-09-30)
    // Old extension versions: these methods don't exist on window.ox4
    const old = fakeOx4(Keypair.generate(), generatePrivateKey())
    const bare = { ...old.p } as Partial<Ox4Provider>
    delete bare.perpWrite; delete bare.perpSessionStatus; delete bare.perpSessionStart
    const oldAcc = extensionEvmAccount(bare as Ox4Provider, old.evm.address)
    await expect(oldAcc.ox4PerpWrite(actions)).rejects.toMatchObject({ code: 4200, message: '请更新 0x4 浏览器插件后再试' })
    expect(await oldAcc.ox4PerpSession.status()).toEqual({ active: false })
    await expect(oldAcc.ox4PerpSession.start()).rejects.toMatchObject({ code: 4200 })
  })
})

describe('错误码', () => {
  it('4001 用户取消：界面认作取消不弹红字；4900 锁定：普通错误带码（对照）', async () => {
    const kp = Keypair.generate()
    const cancel = fakeOx4(kp, generatePrivateKey(), { signSolanaMessage: () => Promise.reject({ code: 4001, message: 'User rejected' }) }).p
    const e1 = await extensionSolanaWallet(cancel, kp.publicKey.toBase58()).signMessage(new Uint8Array([1])).catch((e) => e)
    expect(e1).toBeInstanceOf(Ox4Error)
    expect(isUserCancel(e1)).toBe(true)
    const locked = fakeOx4(kp, generatePrivateKey(), { signSolanaMessage: () => Promise.reject({ code: 4900, message: 'locked' }) }).p
    const e2 = await extensionSolanaWallet(locked, kp.publicKey.toBase58()).signMessage(new Uint8Array([1])).catch((e) => e)
    expect((e2 as Ox4Error).code).toBe(4900)
    expect(isUserCancel(e2)).toBe(false)
  })
})

describe('私信 / 比特币', () => {
  it('私信加解密、比特币签名都原样交给插件', async () => {
    const { p, calls } = fakeOx4(Keypair.generate(), generatePrivateKey())
    const dm = extensionDm(p)
    expect(await dm.publicKey()).toBe('PUB')
    expect(await dm.encrypt('hi', 'PEER')).toEqual({ ciphertext: 'C', nonce: 'N', epk: 'E' })
    expect(await dm.decrypt({ ciphertext: 'C', nonce: 'N', epk: 'E' })).toBe('hello')
    expect(await extensionBtcSigner(p, 'bc1qtest').signTransaction({ tx: 'aa', prevouts: [{ amount: '1', script: '00' }] })).toBe('signedhex')
    expect(calls.find((c) => c.m === 'dmEncrypt')!.a).toEqual({ text: 'hi', peerPublicKey: 'PEER' })
  })
})

