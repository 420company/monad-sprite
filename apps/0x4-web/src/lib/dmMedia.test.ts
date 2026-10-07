// 私信多图：每张各自 AES-GCM 加密上传 → 描述放进端到端加密的私信正文 → 对方解开正文、下载密文、逐张解密，内容逐字节一致。
// 全程真实加解密（WebCrypto + x25519），只把上传 / 下载换成内存。旧版单图消息照常解析；旧版 App 至少认得第一张。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveObjectURL } from 'node:buffer'

vi.hoisted(() => {
  const g = globalThis as unknown as { location?: unknown }
  g.location ??= { protocol: 'http:', host: 'localhost', origin: 'http://localhost', pathname: '/', href: 'http://localhost/' }
})

import { x25519 } from '@noble/curves/ed25519'
import { albumText, clearDecryptCache, decryptThumbUrl, decryptToUrl, dmMediaItems, encryptMedia, mediaLabel, mediaText, parseDmMedia, type DmMedia } from './dmMedia'
import { localDmFromKey } from './vault/dm'

// 「服务器」：上传的密文存在这里，下载从这里拿
const server = new Map<string, Blob>()
let seq = 0
const upload = async (data: Blob) => { const url = `/files/${(++seq).toString(16).padStart(24, '0')}.bin`; server.set(url, data); return { url } }
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = String(input)
  const hit = [...server.entries()].find(([k]) => u.endsWith(k))
  return hit ? new Response(hit[1]) : new Response('nope', { status: 404 })
}) as typeof fetch

const bytesOf = async (objectUrl: string) => new Uint8Array(await resolveObjectURL(objectUrl)!.arrayBuffer())
const payload = (n: number, size = 3000) => { const u = new Uint8Array(size); for (let i = 0; i < size; i++) u[i] = (i * 31 + n * 7) & 255; return u }

beforeEach(() => clearDecryptCache())

describe('私信多图加解密往返', () => {
  it('3 张图 + 1 个视频：各自密钥上传，合成一条加密私信，对方逐张解密一致', async () => {
    const files = [0, 1, 2].map((i) => new Blob([payload(i)], { type: 'image/png' }))
    const video = new Blob([payload(9, 5000)], { type: 'video/mp4' })
    const items: DmMedia[] = []
    for (const f of files) items.push(await encryptMedia(f, 'image', { upload }))
    items.push(await encryptMedia(video, 'video', { upload }))

    // 服务器上只有密文：和明文不同，也不含明文片段
    for (const [i, it] of items.entries()) {
      const ct = new Uint8Array(await server.get(it.url)!.arrayBuffer())
      const plain = i < 3 ? payload(i) : payload(9, 5000)
      expect(ct.length).toBe(plain.length + 16)   // AES-GCM 标签 16 字节
      expect(Buffer.from(ct).includes(Buffer.from(plain.slice(0, 64)))).toBe(false)
    }
    expect(new Set(items.map((x) => x.key)).size).toBe(4)   // 每张各自一把密钥

    // 端到端：正文用对方公钥加密，对方私钥解开
    const bobPriv = x25519.utils.randomSecretKey()
    const alice = localDmFromKey(x25519.utils.randomSecretKey()), bob = localDmFromKey(bobPriv)
    const text = albumText(items)
    const wire = await alice.encrypt(text, await bob.publicKey())
    expect(wire.ciphertext.length).toBeLessThan(60_000)     // 服务端单条密文上限
    const got = parseDmMedia(await bob.decrypt(wire))!
    expect(got).not.toBeNull()

    const list = dmMediaItems(got)
    expect(list).toHaveLength(4)
    expect(list.map((x) => x.kind)).toEqual(['image', 'image', 'image', 'video'])
    // 发送方自己的缓存清掉，走真的下载 + 解密
    clearDecryptCache()
    for (let i = 0; i < 3; i++) expect(await bytesOf(await decryptToUrl(list[i]))).toEqual(payload(i))
    expect(await bytesOf(await decryptToUrl(list[3]))).toEqual(payload(9, 5000))
    // Node 里没有 canvas，出不了缩略图，缩略图回退解大图
    expect(await bytesOf(await decryptThumbUrl(list[0]))).toEqual(payload(0))
  })

  it('密钥不对解不开', async () => {
    const m = await encryptMedia(new Blob([payload(1)], { type: 'image/png' }), 'image', { upload })
    clearDecryptCache()
    const other = await encryptMedia(new Blob([payload(2)], { type: 'image/png' }), 'image', { upload })
    clearDecryptCache()
    await expect(decryptToUrl({ ...m, key: other.key })).rejects.toBeTruthy()
  })

  it('旧版 App 兼容：外层就是第一张；单张消息还是老格式', async () => {
    const a = await encryptMedia(new Blob([payload(1)], { type: 'image/png' }), 'image', { upload })
    const b = await encryptMedia(new Blob([payload(2)], { type: 'image/png' }), 'image', { upload })
    const album = parseDmMedia(albumText([a, b]))!
    expect(album.t).toBe('media')
    expect(album.url).toBe(a.url); expect(album.key).toBe(a.key); expect(album.iv).toBe(a.iv)
    expect(album.items!.every((x) => x.items === undefined)).toBe(true)   // 不嵌套
    expect(mediaLabel(album)).toBe('[图片] ×2')

    const single = parseDmMedia(albumText([a]))!
    expect(single.items).toBeUndefined()
    expect(albumText([a])).toBe(mediaText(a))
    expect(dmMediaItems(single)).toEqual([single])
    expect(mediaLabel(single)).toBe('[图片]')
  })

  it('items 里混进坏数据只保留合格的，最多 9 个', async () => {
    const a = await encryptMedia(new Blob([payload(1)], { type: 'image/png' }), 'image', { upload })
    const many = { ...a, items: [...Array.from({ length: 12 }, () => a), { t: 'media', kind: 'image' }, null] } as unknown as DmMedia
    expect(dmMediaItems(many)).toHaveLength(9)
    expect(dmMediaItems({ ...a, items: [null] } as unknown as DmMedia)).toEqual([{ ...a, items: [null] }])
  })

  it('上传进度从 0 走到 1', async () => {
    const seen: number[] = []
    await encryptMedia(new Blob([payload(3)], { type: 'video/mp4' }), 'video', { upload: async (d, _n, p) => { p?.(0.5); p?.(1); return upload(d) }, onProgress: (x) => seen.push(x) })
    expect(seen).toEqual([0.5, 1])
  })
})
