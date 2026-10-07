import { describe, expect, it } from 'vitest'
import { absUrl, postImages, resolveImage, thumbOf } from './postImage'

describe('帖子图片', () => {
  it('老帖子只有 image：列表回退用原图，没有宽高', () => {
    const [img] = postImages({ image: '/files/abc.jpg', images: null })
    expect(img).toEqual({ url: '/files/abc.jpg' })
    expect(thumbOf(img)).toBe('/files/abc.jpg')
  })
  it('images 为空数组时也回退到 image', () => {
    expect(postImages({ image: '/files/old.png', images: [] })).toEqual([{ url: '/files/old.png' }])
    expect(postImages({ image: null })).toEqual([])
  })
  it('新帖子用 images 里的缩略图和宽高', () => {
    const list = postImages({ image: '/files/a.webp', images: [{ url: '/files/a.webp', thumb: '/files/a_t.webp', w: 1200, h: 1600 }, { url: '/files/b.jpg' }] })
    expect(list.map(thumbOf)).toEqual(['/files/a_t.webp', '/files/b.jpg'])
    expect(list[0]).toMatchObject({ w: 1200, h: 1600 })
  })
  it('只有 url 的新文件名能推出缩略图和宽高（群聊消息、老客户端发的帖）', () => {
    const id = '0123456789abcdef01234567'
    expect(resolveImage({ url: `/files/${id}_1600x900.webp` })).toEqual({ url: `/files/${id}_1600x900.webp`, thumb: `/files/${id}_1600x900_t.webp`, w: 1600, h: 900 })
    expect(resolveImage({ url: `/files/${id}_320x240.gif` }).thumb).toBe(`/files/${id}_320x240_t.webp`)
    expect(resolveImage({ url: `/files/${id}.jpg` })).toEqual({ url: `/files/${id}.jpg` })
  })
  it('补全域名', () => {
    expect(absUrl('/files/x.webp', 'https://api.example')).toBe('https://api.example/files/x.webp')
    expect(absUrl('blob:abc', 'https://api.example')).toBe('blob:abc')
  })
})
