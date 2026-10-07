// 本机存储改名：品牌改成 0x4（2026-09-25）时存储键换了前缀，这里把旧前缀的键搬到 0x4.*。
// 旧前缀必须原样留着才读得到老数据；删了这个文件，很久没打开过的老用户钱包会不见。
//
// ⚠️ 必须在任何 store 之前执行：zustand 的 persist 在 store 创建（模块导入）那一刻就同步读 localStorage，
//    所以 main.tsx 里这个文件紧跟 polyfills 第二个导入，不能往后挪。
// 旧键有、新键没有 → 搬过去；搬完删旧键。新键已经有了（搬过一次）就只删旧键，不覆盖。
const OLD = 'fomo.'
const NEW = '0x4.'

try {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(OLD)) keys.push(k)
  }
  for (const k of keys) {
    const to = NEW + k.slice(OLD.length)
    const v = localStorage.getItem(k)
    if (v !== null && localStorage.getItem(to) === null) localStorage.setItem(to, v)
    localStorage.removeItem(k)
  }
} catch { /* 存储不可用（隐私模式等）：什么都不做 */ }

export {}
