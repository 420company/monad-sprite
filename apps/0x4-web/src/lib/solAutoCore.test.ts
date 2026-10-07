// solAutoCore 的常量和地址推算：常量对官方代币库；程序 PDA 对 Rust 测试 pdas_match_ts_core 算出的同一组值
// （2026-10-04：手写的关联代币账户程序地址错了一段，分叉联调时才发现，从此两边都钉死）
import { describe, expect, it } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT } from '@solana/spl-token'
import * as core from './solAutoCore'

const user = new PublicKey('EGrCpo2eLswD8PkSxNgCLuMRhGxa1PEHmnDGkRaYQHAS')
const bonk = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263')

describe('solAutoCore', () => {
  it('程序常量和官方代币库一致', () => {
    expect(core.TOKEN_PROGRAM.equals(TOKEN_PROGRAM_ID)).toBe(true)
    expect(core.TOKEN_2022_PROGRAM.equals(TOKEN_2022_PROGRAM_ID)).toBe(true)
    expect(core.ATA_PROGRAM.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true)
  })
  it('关联代币账户和官方算法一致（经典 / 2022 / 原生 SOL）', () => {
    expect(core.ata(user, core.SOL_USDC).equals(getAssociatedTokenAddressSync(core.SOL_USDC, user))).toBe(true)
    expect(core.ata(user, bonk, core.TOKEN_2022_PROGRAM).equals(getAssociatedTokenAddressSync(bonk, user, false, TOKEN_2022_PROGRAM_ID))).toBe(true)
    const pdaOwner = core.solAutoVaultAuth(user, NATIVE_MINT)
    expect(core.ata(pdaOwner, NATIVE_MINT).equals(getAssociatedTokenAddressSync(NATIVE_MINT, pdaOwner, true))).toBe(true)
  })
  it('程序 PDA 和 Rust 测试算出的一致', () => {
    expect(core.solAutoConfig().toBase58()).toBe('2x6kPexd9V49XjTQM3fUj8of2EohB8CxbxReJ8ZviWvc')
    expect(core.solAutoUser(user).toBase58()).toBe('7mYAM78c2Tm5PRqYhiVvBPYaEus5wHik1Z6SYTMDLMqU')
    expect(core.solAutoPull(user).toBase58()).toBe('BqmvpQpBJzk33XiPrNzcZTT347HhwyVkwWP4MeRy4hqq')
    expect(core.solAutoStage(user).toBase58()).toBe('FRMhBXHuYYggDH5XV1f4Mw2u3UsNNwkDAsomMrUmPgpD')
    expect(core.solAutoVaultAuth(user, bonk).toBase58()).toBe('6DCVbzXjfscxzkfmhtHtKr1mgdi4Y7SGX345ypN5gkjz')
    expect(core.solAutoVault(user, bonk).toBase58()).toBe('EeKAQTwhz7vB51NPVvLhjRJU9C8Up2oncrjZRkXYfCMh')
    expect(core.ata(user, core.SOL_USDC).toBase58()).toBe('9rqYZVz3pvQBxS5GCusB7Uj4sYa9q1VXn7DkhivT7dKz')
  })
  it('路由不是 Jupiter 的拒绝', () => {
    const swap = { programId: '11111111111111111111111111111111', accounts: [], data: '' }
    expect(() => core.solAutoBuyIx({ operator: user, user, mint: bonk, mintTokenProgram: core.TOKEN_PROGRAM, amountIn: 1n, minOut: 1n, swap })).toThrow()
  })
  it('路由账户外层一律不签名', () => {
    const swap = { programId: core.JUPITER_V6.toBase58(), accounts: [{ pubkey: core.solAutoStage(user).toBase58(), isSigner: true, isWritable: false }, { pubkey: user.toBase58(), isSigner: true, isWritable: true }], data: 'AQID' }
    const ix = core.solAutoBuyIx({ operator: bonk, user, mint: bonk, mintTokenProgram: core.TOKEN_PROGRAM, amountIn: 5n, minOut: 7n, swap })
    const route = ix.keys.slice(17)
    expect(route.every((k) => !k.isSigner)).toBe(true)
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([bonk.toBase58()])
    // 数据：识别码 + amount_in + min_out + 路由数据（长度前缀 + 3 字节）
    expect([...ix.data.subarray(0, 8)]).toEqual([102, 6, 61, 18, 1, 218, 235, 234])
    expect(ix.data.readBigUInt64LE(8)).toBe(5n)
    expect(ix.data.readBigUInt64LE(16)).toBe(7n)
    expect(ix.data.readUInt32LE(24)).toBe(3)
    expect([...ix.data.subarray(28)]).toEqual([1, 2, 3])
  })
  it('解用户状态', () => {
    const b = Buffer.alloc(106)
    Buffer.from([91, 116, 68, 126, 31, 175, 44, 79]).copy(b)
    b.writeBigUInt64LE(50_000_000n, 40); b.writeBigInt64LE(1800000000n, 48); b.writeBigInt64LE(1790000000n, 56); b.writeBigUInt64LE(20_000_000n, 64); b[72] = 1
    b.fill(7, 74, 106)
    expect(core.decodeSolAutoUser(b)).toEqual({ perDay: 50_000_000n, until: 1800000000n, dayStart: 1790000000n, spent: 20_000_000n, active: true, accountTag: '07'.repeat(32) })
    expect(core.decodeSolAutoUser(Buffer.alloc(106))).toBeNull()
  })
  it('开启指令带账号标记', async () => {
    const tag = await core.solAutoAccountTag('0xabc')
    expect(Buffer.from(tag).toString('hex')).toBe('eb4b9e8905923468a20ce3dc86bcdefef67f743a8156f44ca52e548e62e2c8f0')   // python3 hashlib.sha256(b'0xabc')
    const ix = core.solAutoEnableIx(user, 50_000_000n, 1800000000n, tag)
    expect(ix.data.length).toBe(8 + 8 + 8 + 32)
    expect(ix.data.subarray(24).equals(Buffer.from(tag))).toBe(true)
    expect(() => core.solAutoEnableIx(user, 1n, 1n, new Uint8Array(31))).toThrow()
  })
})
