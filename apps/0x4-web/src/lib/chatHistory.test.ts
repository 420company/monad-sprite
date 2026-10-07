// 聊天记录纯函数：合并去重、排序、游标、回执换 id、删除，以及私信密文解码（真实 X25519 + AES-GCM）
import { describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { byTsId, confirmLocal, decodeDm, mergeMessages, olderCursor, removeIds } from './chatHistory'
import { localDmFromKey } from './vault/dm'

const m = (id: string, ts: number, text = id) => ({ id, ts, text, from: 'a' })

describe('mergeMessages', () => {
  it('按 id 去重，服务器的数据覆盖本地，按 (ts, id) 排序', () => {
    const a = [m('03', 3), m('01', 1)]
    const b = [m('02', 2), m('03', 3, 'server')]
    const out = mergeMessages(a, b)
    expect(out.map((x) => x.id)).toEqual(['01', '02', '03'])
    expect(out[2].text).toBe('server')
  })
  it('同一毫秒按 id 排（服务端 id 按发送顺序递增）', () => {
    expect(mergeMessages([m('0b', 5)], [m('0a', 5), m('0c', 5)]).map((x) => x.id)).toEqual(['0a', '0b', '0c'])
    expect([m('x', 2), m('y', 1)].sort(byTsId)[0].id).toBe('y')
  })
  it('往上翻一页（插到前面）再收到实时消息（接在后面），都不重复', () => {
    let list = mergeMessages([], [m('05', 5), m('06', 6)])
    list = mergeMessages(list, [m('03', 3), m('04', 4), m('05', 5)])   // 更早一页，和已有的重叠一条
    list = mergeMessages(list, [m('06', 6)])                            // ws 重复推送
    list = mergeMessages(list, [m('07', 7)])
    expect(list.map((x) => x.id)).toEqual(['03', '04', '05', '06', '07'])
  })
  it('没有新消息时原样返回（不触发重渲染）', () => {
    const a = [m('01', 1)]
    expect(mergeMessages(a, [])).toBe(a)
  })
  it('超过上限丢最旧的', () => {
    const many = Array.from({ length: 10 }, (_, i) => m(`0${i}`, i))
    expect(mergeMessages([], many, 4).map((x) => x.id)).toEqual(['06', '07', '08', '09'])
  })
})

describe('分页游标 / 回执 / 删除', () => {
  it('游标是最早一条正式消息的 (ts, id)，本地还没回执的跳过', () => {
    expect(olderCursor([m('lxyz', 1), m('0ab', 2), m('0ac', 3)])).toBe('before=2&beforeId=0ab')
    expect(olderCursor([])).toBe('')
    expect(olderCursor([m('lonly', 1)])).toBe('')
  })
  it('回执到了：本地 id 换成服务器 id 和时间；实时推送已经先到过同 id 的也不重复', () => {
    const list = [m('01', 1), m('lcid', 9, 'hi')]
    expect(confirmLocal(list, 'lcid', 'd02', 2)!.map((x) => [x.id, x.ts])).toEqual([['01', 1], ['d02', 2]])
    expect(confirmLocal([m('lcid', 9), m('d02', 2)], 'lcid', 'd02', 2)!.map((x) => x.id)).toEqual(['d02'])
    expect(confirmLocal(list, 'lnope', 'd02', 2)).toBeNull()
  })
  it('removeIds', () => {
    expect(removeIds([m('1', 1), m('2', 2), m('3', 3)], ['2', 'x']).map((x) => x.id)).toEqual(['1', '3'])
    expect(removeIds(undefined, ['1'])).toEqual([])
  })
})

describe('decodeDm（真实加解密）', () => {
  const alice = localDmFromKey(x25519.utils.randomSecretKey())
  const bob = localDmFromKey(x25519.utils.randomSecretKey())
  const row = { id: 'd1', from: 'A', to: 'B', ts: 1 }
  it('发给对方的那份对方能解，发给自己的那份自己能解', async () => {
    const [bobPub, alicePub] = [await bob.publicKey(), await alice.publicKey()]
    const forBob = await alice.encrypt('你好 👋', bobPub)
    const forSelf = await alice.encrypt('你好 👋', alicePub)
    expect((await decodeDm({ ...row, ...forBob }, (p) => bob.decrypt(p))).text).toBe('你好 👋')
    expect((await decodeDm({ ...row, ...forSelf }, (p) => alice.decrypt(p))).text).toBe('你好 👋')
    // 拿错那份：解不开 → undecryptable，不抛错
    const wrong = await decodeDm({ ...row, ...forBob }, (p) => alice.decrypt(p))
    expect(wrong).toMatchObject({ undecryptable: true, text: '' })
  })
  it('旧版本发的（没有自己那份）→ legacy', async () => {
    expect(await decodeDm({ ...row, legacy: true }, (p) => alice.decrypt(p))).toMatchObject({ legacy: true, text: '' })
  })
  it('没有私信密钥 → 解不开', async () => {
    const forBob = await alice.encrypt('x', await bob.publicKey())
    expect(await decodeDm({ ...row, ...forBob }, null)).toMatchObject({ undecryptable: true })
  })
})
