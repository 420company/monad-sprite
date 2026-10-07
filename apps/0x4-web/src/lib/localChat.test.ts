// 本机聊天记录：真实 AES-GCM 加解密往返（成功路径），库里没有明文，换了密钥 / 挪了位置都解不开，按所有者和会话分开
import { describe, expect, it } from 'vitest'
import { LocalChat, memoryBackend } from './localChat'

const newKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

describe('本机加密存储', () => {
  it('写入后读回原样，库里只有密文', async () => {
    const be = memoryBackend()
    const key = await newKey()
    const lc = new LocalChat(be, async () => key)
    const conv = LocalChat.conv('me', 'd', 'peer')
    const msgs = [
      { id: 'd2', from: 'peer', to: 'me', text: '第二条 🔐', ts: 2000 },
      { id: 'd1', from: 'me', to: 'peer', text: '第一条', ts: 1000 },
      { id: 'd3', from: 'peer', to: 'me', text: '', ts: 3000, legacy: true },
    ]
    await lc.save(conv, msgs)
    const back = await lc.load<typeof msgs[number]>(conv)
    expect(back).toEqual([msgs[1], msgs[0], msgs[2]])   // 按时间正序

    // 存进库的内容看不到明文
    const dump = JSON.stringify([...be.raw.values()].map((r) => ({ ...r, ct: new TextDecoder().decode(r.ct) })))
    expect(dump).not.toContain('第一条')
    expect(dump).not.toContain('第二条')
    expect([...be.raw.values()].every((r) => r.iv.length === 12 && r.ct.length > 16)).toBe(true)

    // 同一条重写：覆盖不重复
    await lc.save(conv, [{ ...msgs[0], text: '改过' }])
    expect((await lc.load<typeof msgs[number]>(conv)).map((m) => m.text)).toEqual(['第一条', '改过', ''])
  })

  it('换了密钥读不出（跳过，不报错）；密文挪到别的位置也解不开', async () => {
    const be = memoryBackend()
    const lc = new LocalChat(be, async () => k1)
    const k1 = await newKey()
    const conv = LocalChat.conv('me', 'g', 'g1')
    await lc.save(conv, [{ id: 'a', ts: 1, text: 'x' }])
    const other = new LocalChat(be, newKey)
    expect(await other.load(conv)).toEqual([])
    // 把 a 的密文原样搬到另一个会话的键下：附加数据绑定了位置，解不开
    const rec = [...be.raw.values()][0]
    const moved = LocalChat.conv('me', 'g', 'g2')
    await be.put([{ ...rec, k: `${moved}|a`, conv: moved }])
    expect(await lc.load(moved)).toEqual([])
  })

  it('按所有者、会话分开；删除单条、清空会话、清空所有者；附加信息加密存', async () => {
    const be = memoryBackend()
    const key = await newKey()
    const lc = new LocalChat(be, async () => key)
    await lc.save(LocalChat.conv('alice', 'd', 'bob'), [{ id: '1', ts: 1 }, { id: '2', ts: 2 }])
    await lc.save(LocalChat.conv('alice', 'd', 'carol'), [{ id: '3', ts: 3 }])
    await lc.save(LocalChat.conv('alice', 'g', 'g1'), [{ id: '4', ts: 4 }])
    await lc.save(LocalChat.conv('zed', 'd', 'bob'), [{ id: '5', ts: 5 }])
    expect((await lc.list('alice', 'd')).sort()).toEqual(['bob', 'carol'])
    expect(await lc.list('alice', 'g')).toEqual(['g1'])
    expect(await lc.list('zed', 'd')).toEqual(['bob'])

    await lc.remove(LocalChat.conv('alice', 'd', 'bob'), ['1'])
    expect((await lc.load(LocalChat.conv('alice', 'd', 'bob'))).map((m) => m.id)).toEqual(['2'])
    await lc.clearConv(LocalChat.conv('alice', 'd', 'carol'))
    expect(await lc.list('alice', 'd')).toEqual(['bob'])

    await lc.setMeta('alice', 'dm', { unread: { bob: 3 }, peers: { bob: { nickname: '鲍勃' } } })
    expect(await lc.getMeta('alice', 'dm')).toEqual({ unread: { bob: 3 }, peers: { bob: { nickname: '鲍勃' } } })
    expect(JSON.stringify([...be.meta.values()].map((r) => new TextDecoder().decode(r.ct)))).not.toContain('鲍勃')

    await lc.clearOwner('alice')
    expect(await lc.list('alice', 'd')).toEqual([])
    expect(await lc.list('alice', 'g')).toEqual([])
    expect(await lc.getMeta('alice', 'dm')).toBeNull()
    expect(await lc.list('zed', 'd')).toEqual(['bob'])   // 别的钱包不受影响
  })
})
