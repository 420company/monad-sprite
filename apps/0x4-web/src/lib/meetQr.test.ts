import { describe, expect, it } from 'vitest'
import { parseLoginQr, parseMeetQr } from './meetQr'

describe('电脑端登录二维码', () => {
  it('认得 ox4meet 码', () => {
    expect(parseMeetQr('ox4meet:AbCdEfGhIjKlMnOpQrStUv:0123456789abcdef_-XY')).toEqual({ loginId: 'AbCdEfGhIjKlMnOpQrStUv', challenge: '0123456789abcdef_-XY' })
    expect(parseMeetQr('  ox4meet:AbCdEfGhIjKlMnOpQrStUv:0123456789abcdef_-XY\n')).not.toBeNull()
  })
  it('别的码一律不认', () => {
    expect(parseMeetQr('https://meet.420.meme/abc')).toBeNull()
    expect(parseMeetQr('ox4meet:short:0123456789abcdef')).toBeNull()
    expect(parseMeetQr('ox4meet:AbCdEfGhIjKlMnOpQrStUv:bad chars here!!!!')).toBeNull()
    expect(parseMeetQr('ox4meet:AbCdEfGhIjKlMnOpQrStUv')).toBeNull()
    expect(parseMeetQr('')).toBeNull()
  })
  it('认得管理后台的 ox4admin 码，和 Meet 的码分得开', () => {
    expect(parseLoginQr('ox4admin:AbCdEfGhIjKlMnOpQrStUv:0123456789abcdef_-XY')).toEqual({ kind: 'admin', loginId: 'AbCdEfGhIjKlMnOpQrStUv', challenge: '0123456789abcdef_-XY' })
    expect(parseLoginQr('ox4meet:AbCdEfGhIjKlMnOpQrStUv:0123456789abcdef_-XY')?.kind).toBe('meet')
    expect(parseMeetQr('ox4admin:AbCdEfGhIjKlMnOpQrStUv:0123456789abcdef_-XY')).toBeNull()
    expect(parseLoginQr('ox4lord:AbCdEfGhIjKlMnOpQrStUv:0123456789abcdef_-XY')).toBeNull()
    expect(parseLoginQr('ox4admin:AbCdEfGhIjKlMnOpQrStUv')).toBeNull()
  })
  it('网址格式（手机相机扫码打开）也认，里面的码照原规则校验', () => {
    const code = 'ox4meet:AbCdEfGhIjKlMnOpQrStUv:0123456789abcdef_-XY'
    expect(parseLoginQr(`https://app.420.meme/#/pc-login?c=${encodeURIComponent(code)}`)).toEqual({ kind: 'meet', loginId: 'AbCdEfGhIjKlMnOpQrStUv', challenge: '0123456789abcdef_-XY' })
    expect(parseLoginQr('https://app.420.meme/#/pc-login?c=' + encodeURIComponent('ox4meet:short:x'))).toBeNull()
    expect(parseLoginQr('https://app.420.meme/#/pc-login')).toBeNull()
    expect(parseLoginQr('https://app.420.meme/#/pc-login?c=%E0%A4%A')).toBeNull()
  })
})
