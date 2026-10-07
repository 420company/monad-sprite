// DM multi-image: each image AES-GCM-encrypted and uploaded separately → descriptors go into the end-to-end-encrypted DM body → the peer decrypts the body, downloads the ciphertexts, decrypts one by one — content byte-identical.
// Real encryption throughout (WebCrypto + x25519); only upload / download are swapped for memory. Legacy single-image messages still parse; legacy apps at least recognize the first image.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveObjectURL } from 'node:buffer'

vi.hoisted(() => {
  const g = globalThis as unknown as { location?: unknown }
  g.location ??= { protocol: 'http:', host: 'localhost', origin: 'http://localhost', pathname: '/', href: 'http://localhost/' }
})

import { x25519 } from '@noble/curves/ed25519'
import { albumText, clearDecryptCache, decryptThumbUrl, decryptToUrl, dmMediaItems, encryptMedia, mediaLabel, mediaText, parseDmMedia, type DmMedia } from './dmMedia'
import { localDmFromKey } from './vault/dm'

// "Server": uploaded ciphertexts are stored here; downloads fetch from here
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

    // Only ciphertext on the server: differs from plaintext, contains no plaintext fragments
    for (const [i, it] of items.entries()) {
      const ct = new Uint8Array(await server.get(it.url)!.arrayBuffer())
      const plain = i < 3 ? payload(i) : payload(9, 5000)
      expect(ct.length).toBe(plain.length + 16)   // AES-GCM tag is 16 bytes
      expect(Buffer.from(ct).includes(Buffer.from(plain.slice(0, 64)))).toBe(false)
    }
    expect(new Set(items.map((x) => x.key)).size).toBe(4)   // Each image gets its own key

    // End-to-end: the body is encrypted with the peer's public key, decrypted with their private key
    const bobPriv = x25519.utils.randomSecretKey()
    const alice = localDmFromKey(x25519.utils.randomSecretKey()), bob = localDmFromKey(bobPriv)
    const text = albumText(items)
    const wire = await alice.encrypt(text, await bob.publicKey())
    expect(wire.ciphertext.length).toBeLessThan(60_000)     // Server per-message ciphertext cap
    const got = parseDmMedia(await bob.decrypt(wire))!
    expect(got).not.toBeNull()

    const list = dmMediaItems(got)
    expect(list).toHaveLength(4)
    expect(list.map((x) => x.kind)).toEqual(['image', 'image', 'image', 'video'])
    // Clear the sender's own cache — go through real download + decrypt
    clearDecryptCache()
    for (let i = 0; i < 3; i++) expect(await bytesOf(await decryptToUrl(list[i]))).toEqual(payload(i))
    expect(await bytesOf(await decryptToUrl(list[3]))).toEqual(payload(9, 5000))
    // No canvas in Node — no thumbnails; thumbnail fallback decodes the full image
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
    expect(album.items!.every((x) => x.items === undefined)).toBe(true)   // No nesting
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
