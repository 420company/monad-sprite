// 钱包密钥学的测试。
//
// 这是整个产品里出错代价最高的一块：派生路径错一位，用户拿同一套助记词在
// Phantom / MetaMask 里看到的是另一个地址，会以为币丢了；金库加密错一点，
// 要么解不开（资产永久锁死），要么被人解开。所以这里测的都是真算法，不打桩。
import { describe, expect, it } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  classifySecret, normalizeEvmKey, evmKeyFromKeypair,
  buildVault, decryptText, encryptText, evmAccountFromKey, evmKeyFromMnemonic,
  exportSecretBase58, isMnemonicWord, isValidMnemonic, keypairFromMnemonic, keypairFromSecret,
  newMnemonic, normalizeMnemonic, randomEvmKey, suggestMnemonicWords, unlockVault,
} from './wallet'
import type { Vault } from './types'

// BIP-39 官方测试向量里最常用的那条。全世界的钱包都拿它对派生结果。
const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const PW = 'correct horse battery staple'

describe('助记词词表', () => {
  it('认得词表里的词，拼错的不认；空串当作还没填', () => {
    expect(isMnemonicWord('abandon')).toBe(true)
    expect(isMnemonicWord('abandoon')).toBe(false)
    expect(isMnemonicWord('')).toBe(true)
  })

  it('按前缀给候选词，前缀唯一时只给一个', () => {
    expect(suggestMnemonicWords('aban')).toEqual(['abandon'])
    expect(suggestMnemonicWords('ab')).toContain('ability')
    expect(suggestMnemonicWords('ab').length).toBeLessThanOrEqual(4)
    expect(suggestMnemonicWords('zzz')).toEqual([])
    expect(suggestMnemonicWords('')).toEqual([])
  })

  it('候选词本身都是合法的 BIP-39 词', () => {
    for (const w of suggestMnemonicWords('th')) expect(isMnemonicWord(w)).toBe(true)
  })
})

describe('助记词', () => {
  it('生成的是 12 个词且自校验通过', () => {
    const m = newMnemonic()
    expect(m.split(' ')).toHaveLength(12)
    expect(isValidMnemonic(m)).toBe(true)
  })

  it('改一个词就校验不过（BIP-39 校验位）', () => {
    expect(isValidMnemonic(VECTOR)).toBe(true)
    expect(isValidMnemonic(VECTOR.replace(/about$/, 'abandon'))).toBe(false)
  })

  it('大小写和多余空白会被归一，不该因此派生出不同地址', () => {
    const messy = '  ABANDON   abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon\tABOUT '
    expect(normalizeMnemonic(messy)).toBe(VECTOR)
    expect(keypairFromMnemonic(messy).publicKey.toBase58())
      .toBe(keypairFromMnemonic(VECTOR).publicKey.toBase58())
  })
})

describe('EVM 派生（m/44\'/60\'/0\'/0/0）', () => {
  it('对得上公认测试向量，也就是和 MetaMask 导入同一条助记词看到的地址一致', () => {
    // 这个地址是 BIP-39 那条测试助记词在标准以太坊路径下的结果，各家钱包都一样
    expect(evmAccountFromKey(evmKeyFromMnemonic(VECTOR)).address)
      .toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
  })

  it('同一条助记词永远派生出同一把私钥', () => {
    expect(evmKeyFromMnemonic(VECTOR)).toBe(evmKeyFromMnemonic(VECTOR))
  })

  it('随机 EVM 私钥每次都不同', () => {
    expect(randomEvmKey()).not.toBe(randomEvmKey())
  })
})

describe('Solana 派生（m/44\'/501\'/index\'/0\'）', () => {
  // 这三个地址是用 ed25519-hd-key（Solana 生态公认的 SLIP-0010 实现）独立算出来的，
  // 不是从自家实现里抄的。派生路径错一位，用户拿同一条助记词在 Phantom 里会看到
  // 另一个地址，会以为币丢了 —— 所以必须钉死在外部参考上。
  it.each([
    [0, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'],
    [1, 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb'],
    [5, '2EUrWmf5xMmWER9BtDbXbGbZjoL7R3eTDMXYR6H6cKPj'],
  ])('账户 %i 派生结果对得上独立实现', (index, expected) => {
    expect(keypairFromMnemonic(VECTOR, index).publicKey.toBase58()).toBe(expected)
  })

  it('同一条助记词稳定派生', () => {
    expect(keypairFromMnemonic(VECTOR).publicKey.toBase58())
      .toBe(keypairFromMnemonic(VECTOR).publicKey.toBase58())
  })

  it('不同账户序号派生出不同地址', () => {
    const a = keypairFromMnemonic(VECTOR, 0).publicKey.toBase58()
    const b = keypairFromMnemonic(VECTOR, 1).publicKey.toBase58()
    expect(a).not.toBe(b)
  })

  it('不同助记词派生出不同地址', () => {
    expect(keypairFromMnemonic(VECTOR).publicKey.toBase58())
      .not.toBe(keypairFromMnemonic(newMnemonic()).publicKey.toBase58())
  })
})

describe('私钥导入导出', () => {
  it('base58 的 64 字节私钥（Phantom 导出格式）能原样回来', () => {
    const kp = Keypair.generate()
    const b58 = exportSecretBase58(kp)
    expect(keypairFromSecret(b58).publicKey.toBase58()).toBe(kp.publicKey.toBase58())
  })

  it('JSON 数字数组（solana-cli 格式）也能导入', () => {
    const kp = Keypair.generate()
    const json = JSON.stringify(Array.from(kp.secretKey))
    expect(keypairFromSecret(json).publicKey.toBase58()).toBe(kp.publicKey.toBase58())
  })

  it('32 字节的种子也认', () => {
    const kp = Keypair.generate()
    const seed = kp.secretKey.slice(0, 32)
    expect(keypairFromSecret(bs58.encode(seed)).publicKey.toBase58()).toBe(kp.publicKey.toBase58())
  })

  it('前后空白不影响导入（用户从别处复制常带空格）', () => {
    const kp = Keypair.generate()
    expect(keypairFromSecret(`  ${exportSecretBase58(kp)}\n`).publicKey.toBase58()).toBe(kp.publicKey.toBase58())
  })

  it('长度不对要明确报错，不能静默产生一个错地址', () => {
    expect(() => keypairFromSecret(bs58.encode(new Uint8Array(16)))).toThrow()
  })
})

describe('金库加密', () => {
  it('同样的明文每次密文都不同（salt 与 iv 必须随机）', async () => {
    const a = await encryptText('hello', PW)
    const b = await encryptText('hello', PW)
    expect(a.data).not.toBe(b.data)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })

  it('原文能还原，且带非 ASCII 也不出错', async () => {
    const text = '助记词 mnemonic 🔑'
    expect(await decryptText(await encryptText(text, PW), PW)).toBe(text)
  })

  it('密码错了要抛错，不能返回垃圾数据', async () => {
    const blob = await encryptText('secret', PW)
    await expect(decryptText(blob, PW + 'x')).rejects.toThrow()
  })

  it('密文被改过一个字节就解不开（AES-GCM 的认证标签）', async () => {
    const blob = await encryptText('secret', PW)
    const bytes = Uint8Array.from(atob(blob.data), (c) => c.charCodeAt(0))
    bytes[0] ^= 0xff
    let flipped = ''
    bytes.forEach((b) => (flipped += String.fromCharCode(b)))
    await expect(decryptText({ ...blob, data: btoa(flipped) }, PW)).rejects.toThrow()
  })

  it('迭代次数记在密文里，将来调高了也解得开老数据', async () => {
    const blob = await encryptText('secret', PW)
    expect(blob.iterations).toBeGreaterThanOrEqual(250_000)
  })
})

describe('金库构建与解锁', () => {
  it('v2 金库解锁后两条链的地址都对得上', async () => {
    const kp = keypairFromMnemonic(VECTOR)
    const evmKey = evmKeyFromMnemonic(VECTOR)
    const vault = await buildVault(kp, evmKey, PW, VECTOR)
    const u = await unlockVault(vault, PW)
    expect(u.keypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58())
    expect(u.evm.address).toBe(vault.evmAddress)
    expect(u.upgraded).toBeUndefined()
  })

  it('密码错了解不开', async () => {
    const vault = await buildVault(keypairFromMnemonic(VECTOR), evmKeyFromMnemonic(VECTOR), PW, VECTOR)
    await expect(unlockVault(vault, 'wrong')).rejects.toThrow()
  })

  it('金库被人改了 publicKey 要当作损坏，不能拿错身份进去', async () => {
    const vault = await buildVault(keypairFromMnemonic(VECTOR), evmKeyFromMnemonic(VECTOR), PW, VECTOR)
    const tampered = { ...vault, publicKey: Keypair.generate().publicKey.toBase58() }
    await expect(unlockVault(tampered, PW)).rejects.toThrow('金库数据损坏')
  })

  it('不带助记词时不写 mnemonic 字段（私钥导入的钱包没有助记词可给）', async () => {
    const kp = Keypair.generate()
    const vault = await buildVault(kp, randomEvmKey(), PW)
    expect(vault.mnemonic).toBeUndefined()
  })
})

describe('v1 老金库升级', () => {
  /** 造一个只有 Solana 私钥的老金库 */
  async function v1Vault(withMnemonic: boolean): Promise<Vault> {
    const kp = withMnemonic ? keypairFromMnemonic(VECTOR) : Keypair.generate()
    const full = await buildVault(kp, randomEvmKey(), PW, withMnemonic ? VECTOR : undefined)
    const { evmSecret: _drop, evmAddress: _drop2, ...rest } = full
    return { ...rest, version: 1 } as Vault
  }

  it('有助记词的老金库，补出来的 EVM 地址要和助记词标准路径一致', async () => {
    const u = await unlockVault(await v1Vault(true), PW)
    expect(u.upgraded).toBeDefined()
    expect(u.evm.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
    expect(u.upgraded!.evmAddress).toBe(u.evm.address)
    expect(u.upgraded!.version).toBe(2)
  })

  it('没有助记词的老金库，按 Solana 私钥固定补出 EVM（和私钥导入同一规则），Solana 身份不能变', async () => {
    const old = await v1Vault(false)
    const u = await unlockVault(old, PW)
    expect(u.upgraded).toBeDefined()
    expect(u.keypair.publicKey.toBase58()).toBe(old.publicKey)
    expect(u.evm.address).toBe(evmAccountFromKey(evmKeyFromKeypair(u.keypair)).address)
    // 同一个老金库在另一台设备上升级，补出来的是同一个 EVM 地址
    expect((await unlockVault(old, PW)).evm.address).toBe(u.evm.address)
  })

  it('升级后 createdAt 保留原值，不能把老钱包的年龄抹掉', async () => {
    const old = await v1Vault(true)
    old.createdAt = 1_600_000_000_000
    const u = await unlockVault(old, PW)
    expect(u.upgraded!.createdAt).toBe(1_600_000_000_000)
  })

  it('升级出来的金库能用同一个密码再解开', async () => {
    const u1 = await unlockVault(await v1Vault(true), PW)
    const u2 = await unlockVault(u1.upgraded!, PW)
    expect(u2.keypair.publicKey.toBase58()).toBe(u1.keypair.publicKey.toBase58())
    expect(u2.evm.address).toBe(u1.evm.address)
    expect(u2.upgraded).toBeUndefined()
  })
})

describe('私钥类型识别（2026-09-25：以前粘 EVM 私钥报 Non-base58 character）', () => {
  const evm = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  it('EVM 私钥：带不带 0x、大小写、前后空白都认', () => {
    expect(classifySecret('0x' + evm)).toBe('evm')
    expect(classifySecret(evm)).toBe('evm')
    expect(classifySecret('  0x' + evm.toUpperCase() + '\n')).toBe('evm')
    expect(normalizeEvmKey(evm.toUpperCase())).toBe('0x' + evm)
  })
  it('Solana 私钥认，乱写的不认', () => {
    const kp = Keypair.generate()
    expect(classifySecret(bs58.encode(kp.secretKey))).toBe('solana')
    expect(classifySecret(JSON.stringify(Array.from(kp.secretKey)))).toBe('solana')
    expect(classifySecret('0x1234')).toBe(null)
    expect(classifySecret('')).toBe(null)
  })
})
