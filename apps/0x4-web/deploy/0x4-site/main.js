// 0x4 官网（2026-09-29 单屏轮播版）：自动轮播 + 像素 0x4 + 背景 K 线 + 链 logo 轨道 + 小精灵四步。
// 省显卡：每个动画循环只在自己那一页可见时运行，页面切到后台全部停；画布限 30 帧、像素比最多 1.5。
// ★K 线、神经元都是装饰动画，不显示任何价格或数字，不冒充真实行情。
(() => {
  'use strict'
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const coarse = matchMedia('(pointer: coarse)').matches
  const narrow = () => innerWidth < 900
  const SVGNS = 'http://www.w3.org/2000/svg'
  const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e }
  const rand = (a, b) => a + Math.random() * (b - a)

  // ---------------- 语言（CHN / ENG） ----------------
  const LANG_KEY = '0x4.site.lang'
  let lang = ''
  try { lang = localStorage.getItem(LANG_KEY) || '' } catch { /* 隐私模式读不到就按浏览器语言 */ }
  if (lang !== 'zh' && lang !== 'en') lang = 'en'   // goat 9/29：官网默认英文；用户自己切过中文的记住他的选择
  const tr = (k, vars) => {
    let s = (window.I18N && (I18N[lang][k] ?? I18N.en[k])) || ''
    if (vars) for (const v in vars) s = s.replace(`{${v}}`, vars[v])
    return s
  }
  function applyLang(l) {
    lang = l
    try { localStorage.setItem(LANG_KEY, l) } catch { /* 忽略 */ }
    document.documentElement.lang = l === 'zh' ? 'zh-Hans' : 'en'
    $$('[data-i18n]').forEach((e) => { const s = tr(e.dataset.i18n); if (s) e.textContent = s })
    $$('[data-i18n-html]').forEach((e) => { const s = tr(e.dataset.i18nHtml); if (s) e.innerHTML = s })   // 只来自本站自己的 i18n.js
    $$('[data-i18n-svg]').forEach((e) => { const s = tr(e.dataset.i18nSvg); if (s) e.textContent = s })
    $$('[data-i18n-aria]').forEach((e) => { const s = tr(e.dataset.i18nAria); if (s) e.setAttribute('aria-label', s) })
    document.title = tr('meta.title')
    const md = $('meta[name="description"]'); if (md) md.setAttribute('content', tr('meta.desc'))
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)))
    $$('#dots button').forEach((b, i) => b.setAttribute('aria-label', tr('nav.go', { n: i + 1, name: tr('scene.' + scenes[i].dataset.key) })))
    sprite.refresh()
  }
  $$('.lang button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)))

  // ---------------- 像素 0x4（每个点拆成 2×2 小灯珠） ----------------
  const GLYPHS = [
    ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],   // 带斜线的 0（眯眼 420 暗号，别丢）
    ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],   // x
    ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],   // 4
  ]
  const mega = (() => {
    const px = $('#megaPx'), gc = $('#ghostC'), gm = $('#ghostM'), clip = $('#megaClip')
    const rects = []
    GLYPHS.forEach((g, gi) => g.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== '#') return
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const a = { x: (gi * 6 + x + sx * .5 + .05).toFixed(2), y: (y + sy * .5 + .05).toFixed(2), width: .42, height: .42, rx: .07 }
        const r = svgEl('rect', a)
        // 进场：从四散的位置飞回来，左边先到
        r.style.setProperty('--dx', `${rand(-14, 14).toFixed(1)}px`)
        r.style.setProperty('--dy', `${rand(-9, 9).toFixed(1)}px`)
        r.style.setProperty('--r', `${rand(-160, 160).toFixed(0)}deg`)
        r.style.setProperty('--d', `${(.15 + (gi * 6 + x) * .025 + rand(0, .3)).toFixed(2)}s`)
        px.appendChild(r); rects.push(r)
        gc.appendChild(svgEl('rect', a)); gm.appendChild(svgEl('rect', a)); clip.appendChild(svgEl('rect', a))
      }
    })))
    let tw = 0
    // 标语逐字解码：先闪随机像素字符，再从左到右定格（首屏 MEME IS EVERYTHING）
    const words = $$('.s-hero .tagline span[data-t]'), GL = '01X4#$%&@*+=<>/?'
    let dec = 0
    function decode() {
      clearInterval(dec)
      // 先按最终文字量好宽度锁住，滚动的随机字符宽窄不一也不会让整行抖动
      words.forEach((w) => { w.style.width = ''; w.textContent = w.dataset.t; w.style.width = `${w.getBoundingClientRect().width}px` })
      const t0 = performance.now()
      dec = setInterval(() => {
        const e = performance.now() - t0
        let done = true
        words.forEach((w, wi) => {
          const fin = w.dataset.t, start = 1150 + wi * 160
          let s = ''
          for (let i = 0; i < fin.length; i++) {
            const at = start + i * 55 + 260   // 每个字母定格的时刻
            if (e >= at) s += fin[i]
            else { s += e < start ? fin[i] : GL[(Math.random() * GL.length) | 0]; done = false }
          }
          w.textContent = s
        })
        if (done || e > 4000) { clearInterval(dec); words.forEach((w) => { w.textContent = w.dataset.t }) }
      }, 45)
    }
    return {
      enter() {
        if (reduce) return
        decode()
        clearInterval(tw)
        tw = setInterval(() => {   // 随机几颗灯珠亮一下
          for (let i = 0; i < 2; i++) {
            const r = rects[(Math.random() * rects.length) | 0]
            r.classList.add('hot'); setTimeout(() => r.classList.remove('hot'), 520)
          }
        }, 170)
      },
      leave() { clearInterval(tw); tw = 0; clearInterval(dec); words.forEach((w) => { w.textContent = w.dataset.t }) },
    }
  })()

  // ---------------- 背景大 K 线：神经元组成、扫描放电（goat 喜欢的那版，从旧首页搬过来放大到整屏） ----------------
  // 每根 K 线由一簇「神经元」光点组成，一道扫描光从左到右扫过，被扫到的点放电，电流沿连线传给邻居；鼠标经过也会放电。
  // 纯装饰：随机但固定的走势（种子固定），不显示任何价格。只在首屏可见时运行。
  const kline = (() => {
    const cv = $('#kline'), ctx = cv.getContext('2d')
    let W = 0, H = 0, DPR = 1, nodes = [], edges = [], pulses = [], raf = 0, last = 0, scanStart = 0, scanX = -1, pointer = null
    const COL = { up: [104, 232, 186], dn: [255, 150, 160], amb: [205, 189, 255] }
    const glow = (() => {
      const g = document.createElement('canvas'); g.width = g.height = 32
      const c = g.getContext('2d'); const grd = c.createRadialGradient(16, 16, 0, 16, 16, 16)
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(.25, 'rgba(230,220,255,.55)'); grd.addColorStop(1, 'rgba(205,189,255,0)')
      c.fillStyle = grd; c.fillRect(0, 0, 32, 32); return g
    })()
    const node = (x, y, kind, a) => ({ x, y, kind, a, v: 0, g: 0, ref: 0, nb: [] })
    function build() {
      nodes = []; edges = []; pulses = []
      const mobile = W < 760
      // 整屏：横向铺满，纵向留出顶栏和底部按钮
      const x0 = W * .04, x1 = W * .96
      const y0 = H * (mobile ? .16 : .12), y1 = H * (mobile ? .7 : .78)
      const n = mobile ? 11 : Math.round(Math.min(20, Math.max(14, W / 80)))   // 根数少一点，每根够粗才看得出是 K 线
      let s = 1234567; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
      const raw = []; let pv = 0
      // 实体要够高：每根涨跌幅 0.35~1.1，约六成是阳线，整体向上
      for (let i = 0; i < n; i++) { const o = pv, c = o + (rnd() < .6 ? 1 : -1) * (.35 + rnd() * .75); raw.push([o, c, Math.max(o, c) + rnd() * .4, Math.min(o, c) - rnd() * .4]); pv = c }
      const mx = Math.max(...raw.map((r) => r[2])), mn = Math.min(...raw.map((r) => r[3]))
      const norm = (v) => .04 + .92 * (1 - (v - mn) / (mx - mn))   // 价格高的在上面
      const cw = (x1 - x0) / n, per = mobile ? 26 : 20
      for (let i = 0; i < n; i++) {
        const o = norm(raw[i][0]), c = norm(raw[i][1]), hi = norm(raw[i][2]), lo = norm(raw[i][3])
        const kind = c < o ? 'up' : 'dn'   // 屏幕坐标里 c 更小 = 收盘更高 = 阳线
        const cx = x0 + i * cw + cw / 2, bw = cw * .6
        const by0 = y0 + Math.min(o, c) * (y1 - y0), by1 = y0 + Math.max(o, c) * (y1 - y0)
        const count = Math.min(320, Math.max(12, Math.round(bw * Math.max(6, by1 - by0) / per)))
        for (let k = 0; k < count; k++) nodes.push(node(cx - bw / 2 + rnd() * bw, by0 + rnd() * Math.max(6, by1 - by0), kind, .7))
        for (let yy = y0 + hi * (y1 - y0); yy < y0 + lo * (y1 - y0); yy += 4.5) nodes.push(node(cx + (rnd() - .5) * 1.2, yy, kind, .6))
      }
      const amb = mobile ? 90 : 190
      for (let k = 0; k < amb; k++) nodes.push(node(rnd() * W, rnd() * H, 'amb', .28 + rnd() * .2))
      // 就近连线：按 40px 网格分桶找邻居
      const cell = 40, grid = new Map()
      nodes.forEach((nd, i) => { const key = `${Math.floor(nd.x / cell)},${Math.floor(nd.y / cell)}`; (grid.get(key) || grid.set(key, []).get(key)).push(i) })
      nodes.forEach((nd, i) => {
        const gx = Math.floor(nd.x / cell), gy = Math.floor(nd.y / cell), cand = []
        const reach = nd.kind === 'amb' ? 2 : 1
        for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) if (j !== i) cand.push([Math.hypot(nodes[j].x - nd.x, nodes[j].y - nd.y), j])
        cand.sort((a, b) => a[0] - b[0])
        for (const [d, j] of cand.slice(0, nd.kind === 'amb' ? 2 : 3)) {
          if (d > (nd.kind === 'amb' ? 70 : 22)) break
          nd.nb.push(j); if (j > i) edges.push([i, j])
        }
      })
      scanStart = performance.now() + 300
    }
    function fire(i, t) {
      const nd = nodes[i]; if (nd.ref > t) return
      nd.g = 1; nd.v = 0; nd.ref = t + 380
      if (pulses.length > 1100) return
      for (const j of nd.nb) if (Math.random() < .7) pulses.push({ a: i, b: j, t0: t, dur: 140 + Math.random() * 180 })
    }
    function step(t, dt) {
      // 扫描波：像眼睛从左到右看这张图，整屏扫一遍 4 秒，歇 1.4 秒
      const cyc = 5400, k = ((t - scanStart) % cyc + cyc) % cyc
      scanX = k < 4000 ? W * .02 + (k / 4000) * W * .96 : -999
      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i]
        if (nd.kind !== 'amb' && Math.abs(nd.x - scanX) < 7 && Math.random() < .35) nd.v += .6
        if (nd.kind === 'amb' && Math.random() < .0009) nd.v += 1
        if (pointer && Math.abs(nd.x - pointer.x) < 80 && Math.abs(nd.y - pointer.y) < 80 && Math.hypot(nd.x - pointer.x, nd.y - pointer.y) < 80 && Math.random() < .08) nd.v += .7
        if (nd.v >= 1) fire(i, t)
        nd.v *= .96; nd.g *= Math.pow(.9, dt / 16)
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]
        if (t - p.t0 >= p.dur) { nodes[p.b].v += .5; pulses.splice(i, 1) }
      }
    }
    function draw(t) {
      ctx.clearRect(0, 0, W, H)
      ctx.lineWidth = .6; ctx.strokeStyle = 'rgba(205,189,255,.07)'; ctx.beginPath()
      for (const [i, j] of edges) { ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y) }
      ctx.stroke()
      ctx.globalCompositeOperation = 'lighter'
      if (scanX > 0) { const g = ctx.createLinearGradient(scanX - 60, 0, scanX + 6, 0); g.addColorStop(0, 'rgba(205,189,255,0)'); g.addColorStop(1, 'rgba(205,189,255,.08)'); ctx.fillStyle = g; ctx.fillRect(scanX - 60, 0, 66, H) }
      ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(236,228,255,.55)'; ctx.beginPath()
      for (const p of pulses) {
        const a = nodes[p.a], b = nodes[p.b], k = Math.min(1, (t - p.t0) / p.dur), k0 = Math.max(0, k - .35)
        ctx.moveTo(a.x + (b.x - a.x) * k0, a.y + (b.y - a.y) * k0); ctx.lineTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)
      }
      ctx.stroke()
      for (const nd of nodes) {
        const c = COL[nd.kind], al = Math.min(1, nd.a + nd.g * .9)
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${al})`
        const sz = nd.kind === 'amb' ? 1.2 : 1.9
        ctx.fillRect(nd.x - sz / 2, nd.y - sz / 2, sz, sz)
        if (nd.g > .08) { const r = 6 + nd.g * 12; ctx.globalAlpha = nd.g * .85; ctx.drawImage(glow, nd.x - r, nd.y - r, r * 2, r * 2); ctx.globalAlpha = 1 }
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    function loop(t) {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(48, t - (last || t)); last = t
      step(t, dt); draw(t)
    }
    function size() {
      W = cv.clientWidth; H = cv.clientHeight
      DPR = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 1.6)
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR)
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      build()
    }
    function drawStatic() { nodes.forEach((nd, i) => { if (nd.kind !== 'amb' && i % 5 === 0) nd.g = .8 }); draw(performance.now()) }
    // 鼠标 / 手指经过也会让附近的神经元放电
    const stage = $('#stage')
    stage.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); pointer = { x: e.clientX - r.left, y: e.clientY - r.top } }, { passive: true })
    stage.addEventListener('pointerleave', () => { pointer = null })
    return {
      enter() { size(); cancelAnimationFrame(raf); last = 0; if (reduce) drawStatic(); else raf = requestAnimationFrame(loop) },
      leave() { cancelAnimationFrame(raf); raf = 0 },
      resize() { size(); if (!raf) drawStatic() },
    }
  })()

  // ---------------- 链 logo 轨道 ----------------
  const orbit = (() => {
    const box = $('#orbit')
    const INNER = ['bsc', 'ethereum', 'solana', 'bitcoin', 'base', 'arbitrum', 'polygon', 'optimism']
    const OUTER = ['avalanche', 'linea', 'zksync', 'scroll', 'blast', 'mantle', 'sonic', 'berachain', 'unichain', 'monad', 'hyperevm', 'sei', 'apechain', 'world', 'opbnb', 'celo']
    const rings = svgEl('svg', { class: 'rings', viewBox: '-100 -100 200 200', preserveAspectRatio: 'none' })
    const e1 = svgEl('ellipse', { cx: 0, cy: 0 }), e2 = svgEl('ellipse', { cx: 0, cy: 0 })
    rings.append(e1, e2); box.prepend(rings)
    const TILT = -10 * Math.PI / 180
    const make = (list, ring) => list.map((k, i) => {
      const el = document.createElement('span'); el.className = 'coin'
      const img = document.createElement('img'); img.src = `assets/chains/${k}.svg`; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'
      el.appendChild(img); box.appendChild(el)
      return { el, ring, a: (i / list.length) * Math.PI * 2 }
    })
    const coins = [...make(INNER, 0), ...make(OUTER, 1)]
    let W = 0, raf = 0, last = 0
    function geo() {
      W = box.clientWidth
      const g = [{ rx: .28, ry: .17, s: narrow() ? 34 : 50 }, { rx: .46, ry: .27, s: narrow() ? 26 : 38 }]
      // 椭圆线（viewBox 是 -100..100，按比例画）
      e1.setAttribute('rx', g[0].rx * 200); e1.setAttribute('ry', g[0].ry * 200); e1.setAttribute('transform', `rotate(${TILT * 180 / Math.PI})`)
      e2.setAttribute('rx', g[1].rx * 200); e2.setAttribute('ry', g[1].ry * 200); e2.setAttribute('transform', `rotate(${TILT * 180 / Math.PI})`)
      return g
    }
    let G = geo()
    function place() {
      for (const c of coins) {
        const g = G[c.ring]
        const x0 = Math.cos(c.a) * g.rx * W, y0 = Math.sin(c.a) * g.ry * W
        const x = x0 * Math.cos(TILT) - y0 * Math.sin(TILT), y = x0 * Math.sin(TILT) + y0 * Math.cos(TILT)
        const depth = (Math.sin(c.a) + 1) / 2   // 0 = 后面，1 = 前面
        c.el.style.setProperty('--s', `${g.s}px`)
        c.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${(.68 + depth * .38).toFixed(3)})`
        c.el.style.opacity = (.45 + depth * .55).toFixed(2)
        c.el.style.zIndex = depth > .5 ? 3 : 1
      }
    }
    place()
    function loop(now) {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(50, now - (last || now)); last = now
      for (const c of coins) c.a += dt * (c.ring ? -.00011 : .00019)
      place()
    }
    return {
      enter() { G = geo(); place(); if (!reduce) { last = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) } },
      leave() { cancelAnimationFrame(raf); raf = 0 },
      resize() { G = geo(); place() },
    }
  })()

  // ---------------- 小精灵：看 → 想 → 选 → 记 ----------------
  const sprite = (() => {
    const card = $('#brain'), chart = $('#miniChart'), net = $('#net'), desc = $('#stepDesc')
    const stg = [1, 2, 3, 4].map((i) => card.querySelector('.stg' + i))
    const lis = $$('#steps li')
    // K 线卡片：网格、蜡烛（带影线）、均线、成交量
    const L = 28, R = 150, T = 84, B = 186
    const g = svgEl('g', { class: 'grid' })
    for (let i = 0; i <= 3; i++) g.appendChild(svgEl('line', { x1: L - 4, x2: R + 4, y1: T + i * (B - T) / 3, y2: T + i * (B - T) / 3 }))
    chart.appendChild(g)
    let p = 50; const ks = []
    const seq = [.6, -.3, .8, .4, -.7, .9, .5, -.4, 1.1, .6, -.2, .9, -.5, 1.2, .7, 1]
    for (const d of seq) { const o = p, c = p + d * 3; ks.push({ o, c, h: Math.max(o, c) + 1.2 + (Math.abs(d) * 1.3), l: Math.min(o, c) - 1.1 - (Math.abs(d) * .9) }); p = c }
    const lo = Math.min(...ks.map((k) => k.l)), hi = Math.max(...ks.map((k) => k.h))
    const Y = (v) => B - (v - lo) / (hi - lo) * (B - T)
    const st = (R - L) / ks.length
    const maPts = []
    ks.forEach((k, i) => {
      const x = L + st * (i + .5), up = k.c >= k.o
      chart.appendChild(svgEl('line', { x1: x, x2: x, y1: Y(k.h), y2: Y(k.l), class: 'wick ' + (up ? 'c-up' : 'c-dn') }))
      const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c))
      chart.appendChild(svgEl('rect', { x: x - st * .3, y: y1, width: st * .6, height: Math.max(1.5, y2 - y1), rx: .8, class: up ? 'c-up' : 'c-dn' }))
      const vh = 6 + Math.abs(seq[i]) * 14
      chart.appendChild(svgEl('rect', { x: x - st * .3, y: 226 - vh, width: st * .6, height: vh, rx: .6, class: 'vol' }))
      const s = ks.slice(Math.max(0, i - 3), i + 1); maPts.push(`${x.toFixed(1)},${Y(s.reduce((a, q) => a + q.c, 0) / s.length).toFixed(1)}`)
    })
    chart.appendChild(svgEl('polyline', { points: maPts.join(' '), class: 'ma' }))
    const lk = ks[ks.length - 1], lx = L + st * (ks.length - .5)
    chart.appendChild(svgEl('circle', { cx: lx, cy: Y(lk.c), r: 3, class: 'last-ring' }))
    // 神经网络：黄金角螺旋排点，连最近的邻居
    const pts = []
    const N = 46
    for (let i = 0; i < N; i++) { const r = 80 * Math.sqrt((i + .5) / N), a = i * 2.39996; pts.push([290 + Math.cos(a) * r, 150 + Math.sin(a) * r * .92]) }
    const links = svgEl('g', {})
    pts.forEach((a, i) => {
      pts.map((b, j) => [j, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2]).filter(([j]) => j > i).sort((x, y) => x[1] - y[1]).slice(0, 2)
        .forEach(([j]) => links.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: pts[j][0], y2: pts[j][1], class: 'link' })))
    })
    net.appendChild(links)
    const nrn = pts.map(([x, y]) => { const c = svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.6, class: 'nrn' }); net.appendChild(c); return c })
    const wBuy = card.querySelector('.w-buy'), wSell = card.querySelector('.w-sell'), gBuy = card.querySelector('.g-buy'), gSell = card.querySelector('.g-sell')
    let at = 0, cyc = 0, fire = 0, buy = true
    function show(n) {
      at = n
      stg.forEach((s, i) => { s.classList.toggle('lit', i < n); s.classList.toggle('cur', i === n - 1) })
      lis.forEach((li, i) => li.classList.toggle('cur', i === n - 1))
      if (n === 3) buy = !buy
      const win = n >= 3
      wBuy.classList.toggle('win', win && buy); gBuy.classList.toggle('win', win && buy)
      wSell.classList.toggle('win', win && !buy); gSell.classList.toggle('win', win && !buy)
      desc.textContent = tr(`sprite.s${n}.d`)
    }
    function spark() {
      if (at < 2) return
      for (let i = 0; i < (at === 4 ? 4 : 2); i++) {
        const c = nrn[(Math.random() * nrn.length) | 0]
        c.classList.add('fire'); setTimeout(() => c.classList.remove('fire'), 360)
      }
    }
    return {
      enter() {
        clearInterval(cyc); clearInterval(fire)
        show(1)
        cyc = setInterval(() => show(at % 4 + 1), 2350)
        if (!reduce) fire = setInterval(spark, 140)
      },
      leave() { clearInterval(cyc); clearInterval(fire) },
      refresh() { if (at) desc.textContent = tr(`sprite.s${at}.d`) },
    }
  })()

  // ---------------- 「不仅如此」页：FRIENDS, TOKEN, COMMUNITY 一排，进场时逐字解码 ----------------
  const tagRow = (() => {
    const words = $$('.s-social .tagline span[data-t]'), GL = '01X4#$%&@*+=<>/?'
    let dec = 0
    function decode() {
      clearInterval(dec)
      words.forEach((w) => { w.style.width = ''; w.textContent = w.dataset.t; w.style.width = `${w.getBoundingClientRect().width}px` })
      const t0 = performance.now()
      dec = setInterval(() => {
        const e = performance.now() - t0
        let done = true
        words.forEach((w, wi) => {
          const fin = w.dataset.t, start = 700 + wi * 160
          let s = ''
          for (let i = 0; i < fin.length; i++) {
            if (e >= start + i * 55 + 260) s += fin[i]
            else { s += e < start ? fin[i] : GL[(Math.random() * GL.length) | 0]; done = false }
          }
          w.textContent = s
        })
        if (done || e > 3500) { clearInterval(dec); words.forEach((w) => { w.textContent = w.dataset.t }) }
      }, 45)
    }
    return { enter() { if (!reduce) decode() }, leave() { clearInterval(dec); words.forEach((w) => { w.textContent = w.dataset.t }) } }
  })()

  // ---------------- 多链：网络切换胶囊（BSC → Ethereum → Solana → Bitcoin → Base …） ----------------
  const netswitch = (() => {
    const track = $('#nsTrack')
    const NETS = [['bsc', 'BNB Chain'], ['ethereum', 'Ethereum'], ['solana', 'Solana'], ['bitcoin', 'Bitcoin'], ['base', 'Base'], ['arbitrum', 'Arbitrum'], ['polygon', 'Polygon'], ['avalanche', 'Avalanche']]
    const items = NETS.map(([k, name]) => {
      const el = document.createElement('span'); el.className = 'ns-item wait'
      el.innerHTML = `<img src="assets/chains/${k}.svg" alt=""><span>${name}</span>`
      track.appendChild(el); return el
    })
    let i = 0, tm = 0
    items[0].className = 'ns-item in'
    function next() {
      const cur = items[i]; i = (i + 1) % items.length; const nx = items[i]
      cur.className = 'ns-item out'; nx.className = 'ns-item wait'; void nx.offsetWidth; nx.className = 'ns-item in'
      setTimeout(() => { if (cur !== items[i]) cur.className = 'ns-item wait' }, 600)
    }
    return { enter() { clearInterval(tm); if (!reduce) tm = setInterval(next, 1300) }, leave() { clearInterval(tm) } }
  })()

  // ---------------- 交易面板：迷你 K 线 + 现货 / 合约自动切换（纯界面，没有价格数字） ----------------
  const tpanel = (() => {
    const panel = $('#tpanel'), svg = $('#tpChart')
    const W = 320, H = 120, N = 28
    const defs = svgEl('defs', {}); const lg = svgEl('linearGradient', { id: 'tpArea', x1: 0, y1: 0, x2: 0, y2: 1 })
    lg.append(svgEl('stop', { offset: 0, 'stop-color': '#d7c9ff', 'stop-opacity': .28 }), svgEl('stop', { offset: 1, 'stop-color': '#d7c9ff', 'stop-opacity': 0 }))
    defs.appendChild(lg); svg.appendChild(defs)
    const area = svgEl('path', { class: 'area' }), ma = svgEl('polyline', { class: 'ma' })
    const bars = []
    for (let i = 0; i < N; i++) { const w = svgEl('line', { 'stroke-width': 1 }), b = svgEl('rect', { rx: 1 }); svg.append(w, b); bars.push([w, b]) }
    svg.append(area, ma)
    let p = 50, ks = [], tm = 0, mt = 0
    const nextK = () => { const o = p, c = o + (Math.random() < .56 ? 1 : -1) * (1 + Math.random() * 4); p = c; return { o, c, h: Math.max(o, c) + Math.random() * 2.5, l: Math.min(o, c) - Math.random() * 2.5 } }
    for (let i = 0; i < N; i++) ks.push(nextK())
    function draw() {
      const lo = Math.min(...ks.map((k) => k.l)), hi = Math.max(...ks.map((k) => k.h))
      const Y = (v) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 16), st = W / N
      const pts = []
      ks.forEach((k, i) => {
        const x = st * (i + .5), up = k.c >= k.o, [w, b] = bars[i]
        w.setAttribute('x1', x); w.setAttribute('x2', x); w.setAttribute('y1', Y(k.h)); w.setAttribute('y2', Y(k.l)); w.setAttribute('class', up ? 'wk-up' : 'wk-dn')
        const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c))
        b.setAttribute('x', x - st * .3); b.setAttribute('width', st * .6); b.setAttribute('y', y1); b.setAttribute('height', Math.max(1.5, y2 - y1)); b.setAttribute('class', up ? 'c-up' : 'c-dn')
        const s = ks.slice(Math.max(0, i - 4), i + 1); pts.push([x, Y(s.reduce((a, q) => a + q.c, 0) / s.length)])
      })
      ma.setAttribute('points', pts.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' '))
      area.setAttribute('d', `M${pts[0][0]},${H} ` + pts.map((q) => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ') + ` L${pts[pts.length - 1][0]},${H} Z`)
    }
    draw()
    function tick() { ks.shift(); ks.push(nextK()); draw() }
    function flip() {
      panel.dataset.mode = panel.dataset.mode === 'spot' ? 'perp' : 'spot'
      const chips = panel.querySelectorAll(`.tp-chips.m-${panel.dataset.mode} span`)
      chips.forEach((c) => c.classList.remove('on')); chips[(Math.random() * 4) | 0].classList.add('on')
    }
    return {
      enter() { clearInterval(tm); clearInterval(mt); panel.dataset.mode = 'spot'; if (!reduce) { tm = setInterval(tick, 700); mt = setInterval(flip, 3400) } },
      leave() { clearInterval(tm); clearInterval(mt) },
    }
  })()

  // ---------------- 密钥：钥匙外一圈不停变换的加密字符 ----------------
  const cipher = (() => {
    const svg = $('#cipher'), HEX = '0123456789abcdef', N = 64, R = 92
    const ts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2
      const el = svgEl('text', { x: (Math.cos(a) * R).toFixed(2), y: (Math.sin(a) * R).toFixed(2), transform: `rotate(${(a * 180 / Math.PI + 90).toFixed(1)} ${(Math.cos(a) * R).toFixed(2)} ${(Math.sin(a) * R).toFixed(2)})` })
      el.textContent = HEX[(Math.random() * 16) | 0]; svg.appendChild(el); ts.push(el)
    }
    let tm = 0
    function tick() {
      for (let k = 0; k < 6; k++) {
        const el = ts[(Math.random() * N) | 0]
        el.textContent = HEX[(Math.random() * 16) | 0]; el.classList.add('hot'); setTimeout(() => el.classList.remove('hot'), 300)
      }
    }
    return { enter() { clearInterval(tm); if (!reduce) tm = setInterval(tick, 90) }, leave() { clearInterval(tm) } }
  })()

  // ---------------- 视差：鼠标位置写进 --px / --py（-1..1），各层按自己的深度移动 ----------------
  if (!coarse && !reduce) {
    let pend = false, mx = 0, my = 0
    addEventListener('pointermove', (e) => {
      mx = (e.clientX / innerWidth) * 2 - 1; my = (e.clientY / innerHeight) * 2 - 1
      if (pend) return
      pend = true
      requestAnimationFrame(() => { pend = false; const st = document.getElementById('stage').style; st.setProperty('--px', mx.toFixed(3)); st.setProperty('--py', my.toFixed(3)) })
    }, { passive: true })
  }

  // ---------------- 上浮像素光点（密钥页）：纯 CSS 动画，只在当前页跑 ----------------
  $$('[data-motes]').forEach((box) => {
    const n = narrow() ? Math.round(+box.dataset.motes / 2) : +box.dataset.motes
    for (let i = 0; i < n; i++) {
      const m = document.createElement('i')
      m.style.left = `${(Math.random() * 100).toFixed(1)}%`
      m.style.setProperty('--z', `${(2 + Math.random() * 3).toFixed(1)}px`)
      m.style.setProperty('--t', `${(9 + Math.random() * 10).toFixed(1)}s`)
      m.style.setProperty('--dl', `${(-Math.random() * 18).toFixed(1)}s`)
      m.style.setProperty('--dx', `${((Math.random() - .5) * 80).toFixed(0)}px`)
      m.style.setProperty('--o', (.35 + Math.random() * .5).toFixed(2))
      box.appendChild(m)
    }
  })

  // ---------------- 不仅如此页：夜空光斑（柔光圆点缓慢漂浮、闪烁），限 30 帧 ----------------
  const bokeh = (() => {
    const cv = $('#bokeh'), ctx = cv.getContext('2d')
    const COLS = ['255,214,196', '220,206,255', '190,236,255', '255,236,210']
    const sprites = COLS.map((c) => {
      const g = document.createElement('canvas'); g.width = g.height = 64
      const x = g.getContext('2d'), grd = x.createRadialGradient(32, 32, 0, 32, 32, 32)
      grd.addColorStop(0, `rgba(${c},.9)`); grd.addColorStop(.35, `rgba(${c},.35)`); grd.addColorStop(1, `rgba(${c},0)`)
      x.fillStyle = grd; x.fillRect(0, 0, 64, 64); return g
    })
    let W = 0, H = 0, raf = 0, last = 0, ps = []
    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 1.5)
      W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = narrow() ? 22 : 42
      ps = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H * .62, r: 4 + Math.random() * (Math.random() < .2 ? 26 : 10),
        vx: (Math.random() - .5) * .08, vy: -.02 - Math.random() * .05, ph: Math.random() * 6.28, sp: .6 + Math.random() * 1.4, s: sprites[(Math.random() * sprites.length) | 0],
      }))
    }
    function draw(now) {
      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'
      for (const p of ps) {
        p.x += p.vx * 16; p.y += p.vy * 16
        if (p.y < -40) { p.y = H * .62; p.x = Math.random() * W }
        if (p.x < -40) p.x = W + 30; else if (p.x > W + 40) p.x = -30
        ctx.globalAlpha = .25 + .45 * (.5 + .5 * Math.sin(now / 1000 * p.sp + p.ph))
        ctx.drawImage(p.s, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    }
    function loop(now) { raf = requestAnimationFrame(loop); if (now - last < 33) return; last = now; draw(now) }
    return {
      enter() { size(); cancelAnimationFrame(raf); if (reduce) draw(performance.now()); else raf = requestAnimationFrame(loop) },
      leave() { cancelAnimationFrame(raf); raf = 0 },
      resize() { if (raf) size() },
    }
  })()

  // ---------------- 不仅如此页：直播摄像机那边不断飘起小爱心（像直播点赞） ----------------
  const likes = (() => {
    const box = $('#likes')
    let tm = 0
    function spawn() {
      if (box.childElementCount > 8) return
      const h = document.createElement('img'); h.src = 'assets/art/obj-heart.webp'; h.alt = ''
      h.style.setProperty('--x', `${(10 + Math.random() * 50).toFixed(0)}px`)
      h.style.setProperty('--w', `${(22 + Math.random() * 20).toFixed(0)}px`)
      h.style.setProperty('--sx', `${((Math.random() - .5) * 70).toFixed(0)}px`)
      h.style.setProperty('--r', `${((Math.random() - .5) * 30).toFixed(0)}deg`)
      h.style.setProperty('--t', `${(2.2 + Math.random() * 1.2).toFixed(2)}s`)
      h.addEventListener('animationend', () => h.remove())
      box.appendChild(h)
    }
    return {
      enter() { clearInterval(tm); if (!reduce) tm = setInterval(spawn, 650) },
      leave() { clearInterval(tm); box.textContent = '' },
    }
  })()

  // ---------------- 不仅如此页：3D 照片（像苹果的空间照片）----------------
  // 原图 + 一张深度图（BytePlus 生成，近处亮远处暗）：着色器按鼠标位置让近处比远处挪得多，看起来有立体感。
  // 只在这一页可见时画；手机和没鼠标时自己缓慢摆动；浏览器不支持 WebGL 就退回普通背景图。
  const photo3d = (() => {
    const cv = $('#photo3d'), scene = cv.closest('.scene')
    const gl = cv.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' })
    if (!gl) return { enter() {}, leave() {}, resize() {} }
    const vs = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}'
    const fs = `precision mediump float;varying vec2 v;uniform sampler2D img,dep;uniform vec2 sc,m;
      void main(){vec2 uv=(v-.5)*sc+.5;vec2 off=m*.016;float d=texture2D(dep,uv).r;vec2 q=uv-off*(d-.35);
      for(int i=0;i<3;i++){d=texture2D(dep,q).r;q=uv-off*(d-.35);}
      gl_FragColor=vec4(texture2D(img,clamp(q,.001,.999)).rgb,1.);}`
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s }
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr)
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return { enter() {}, leave() {}, resize() {} }
    gl.useProgram(pr)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uSc = gl.getUniformLocation(pr, 'sc'), uM = gl.getUniformLocation(pr, 'm')
    gl.uniform1i(gl.getUniformLocation(pr, 'img'), 0); gl.uniform1i(gl.getUniformLocation(pr, 'dep'), 1)
    let loaded = 0, started = false, raf = 0, W = 0, H = 0, mx = 0, my = 0, cx = 0, cy = 0, hasMouse = false
    function tex(unit, src) {
      const t = gl.createTexture(), im = new Image()
      im.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im)
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
        if (++loaded === 2) { cv.classList.add('ready'); scene.classList.add('has3d'); draw() }
      }
      im.src = src
    }
    function size() {
      const dpr = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.5)
      W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
      gl.viewport(0, 0, cv.width, cv.height)
      const ca = W / H, ia = 16 / 9, z = .93   // 放大一点，边缘挪动时不露底
      gl.uniform2f(uSc, (ca > ia ? 1 : ca / ia) * z, (ca > ia ? ia / ca : 1) * z)
    }
    function draw() { if (loaded < 2) return; gl.uniform2f(uM, cx, cy); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4) }
    addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; hasMouse = true; mx = (e.clientX / innerWidth) * 2 - 1; my = -((e.clientY / innerHeight) * 2 - 1) }, { passive: true })
    function loop(now) {
      raf = requestAnimationFrame(loop)
      if (!hasMouse) { mx = Math.sin(now / 2600) * .8; my = Math.sin(now / 3700) * .35 }   // 手机上自己缓慢摆动
      cx += (mx - cx) * .06; cy += (my - cy) * .06
      draw()
    }
    return {
      enter() {
        if (!started) { started = true; tex(0, `assets/art/social-${narrow() ? 1080 : 1920}.webp`); tex(1, 'assets/art/social-depth.webp') }
        size(); draw(); cancelAnimationFrame(raf); if (!reduce) raf = requestAnimationFrame(loop)
      },
      leave() { cancelAnimationFrame(raf); raf = 0 },
      resize() { if (started) { size(); draw() } },
    }
  })()

  // ---------------- 不仅如此页：猫咪币雨（同一张图反复用，只动 transform / opacity） ----------------
  const rain = (() => {
    const box = $('#rain')
    const n = narrow() ? 8 : 18
    for (let i = 0; i < n; i++) {
      const c = document.createElement('img'); c.alt = ''; c.decoding = 'async'
      const near = Math.random() < .25, w = near ? 70 + Math.random() * 40 : 26 + Math.random() * 30
      c.style.setProperty('--x', `${(Math.random() * 96).toFixed(1)}%`)
      c.style.setProperty('--w', `${w.toFixed(0)}px`)
      c.style.setProperty('--t', `${(near ? 5 + Math.random() * 3 : 8 + Math.random() * 7).toFixed(1)}s`)
      c.style.setProperty('--dl', `${(-Math.random() * 14).toFixed(1)}s`)
      c.style.setProperty('--dx', `${((Math.random() - .5) * 120).toFixed(0)}px`)
      c.style.setProperty('--r0', `${(Math.random() * 360).toFixed(0)}deg`)
      c.style.setProperty('--r1', `${(Math.random() * 360 + (Math.random() < .5 ? -540 : 540)).toFixed(0)}deg`)
      c.style.setProperty('--o', near ? '.95' : (.45 + Math.random() * .35).toFixed(2))
      if (near) c.style.setProperty('--f', 'blur(1.5px)')   // 最近的几枚稍虚，拉出景深
      box.appendChild(c)
    }
    let loadedImgs = false
    return { enter() { if (!loadedImgs) { loadedImgs = true; box.querySelectorAll('img').forEach((c) => { c.src = 'assets/art/obj-coin.webp' }) } }, leave() {} }
  })()

  // ---------------- 轮播 ----------------
  const scenes = $$('.scene')
  const HOOKS = { hero: [mega, kline], chains: [orbit, netswitch], trade: [tpanel], keys: [cipher], social: [photo3d, rain, tagRow, bokeh, likes], sprite: [sprite] }
  const dots = $('#dots')
  scenes.forEach((s, i) => {
    const b = document.createElement('button'); b.type = 'button'
    b.appendChild(document.createElement('i'))
    b.addEventListener('click', () => go(i, true))
    dots.appendChild(b)
  })
  const dotBtns = $$('#dots button')
  let cur = -1, timer = 0, startAt = 0, remain = 0, paused = false
  function loadArt(i) {
    const s = scenes[(i + scenes.length) % scenes.length]
    if (s.dataset.loaded) return
    s.dataset.loaded = '1'
    const bg = s.querySelector('.bg[data-bg]')
    if (bg) bg.style.backgroundImage = `url(assets/art/${bg.dataset.bg}-${narrow() ? 1080 : 1920}.webp)`
    s.querySelectorAll('img[data-src]').forEach((img) => {
      const f = img.dataset.src
      img.src = f.includes('.') ? `assets/art/${f}` : `assets/art/${f}-${narrow() ? 700 : 1100}.webp`
    })
  }
  function go(i, byUser) {
    i = (i + scenes.length) % scenes.length
    if (i === cur) { if (byUser) schedule(+scenes[i].dataset.dur); return }
    const prev = scenes[cur]
    if (prev) {
      prev.classList.remove('on'); prev.setAttribute('aria-hidden', 'true'); prev.inert = true
      ;(HOOKS[prev.dataset.key] || []).forEach((h) => h.leave())
    }
    cur = i
    const s = scenes[i]
    loadArt(i); loadArt(i + 1)
    s.style.setProperty('--dur', `${s.dataset.dur}ms`)
    s.classList.add('on'); s.removeAttribute('aria-hidden'); s.inert = false
    ;(HOOKS[s.dataset.key] || []).forEach((h) => h.enter())
    dotBtns.forEach((b, j) => {
      b.classList.remove('cur'); b.classList.toggle('done', j < i)
      b.setAttribute('aria-current', j === i ? 'true' : 'false')
    })
    const d = dotBtns[i]; d.style.setProperty('--dur', `${s.dataset.dur}ms`); void d.offsetWidth; d.classList.add('cur')
    schedule(+s.dataset.dur)
  }
  // goat 9/29：用户在页面上点过鼠标 / 手指按过，就不再自动翻页，之后由用户自己切换（点进度条、左右滑、方向键、滚轮）
  let manual = false
  let schedule = function (ms) {
    clearTimeout(timer); remain = ms; startAt = performance.now()
    if (!paused && !manual) timer = setTimeout(() => go(cur + 1), ms)
  }
  function pause() {
    if (paused) return
    paused = true; clearTimeout(timer); remain -= performance.now() - startAt
    document.body.classList.add('paused')
    ;(HOOKS[scenes[cur].dataset.key] || []).forEach((h) => h.leave())
  }
  function resume() {
    if (!paused) return
    paused = false; document.body.classList.remove('paused')
    ;(HOOKS[scenes[cur].dataset.key] || []).forEach((h) => h.enter())
    startAt = performance.now(); if (!manual) timer = setTimeout(() => go(cur + 1), Math.max(600, remain))
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()))
  addEventListener('pointerdown', (e) => {
    if (manual || (e.target instanceof Element && e.target.closest('a[data-into]'))) return
    manual = true; clearTimeout(timer); document.body.classList.add('manual')
  })
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(cur + 1, true)
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(cur - 1, true)
  })
  // 滚轮 / 触控板切页（页面本身不滚动）
  let wheelLock = 0, wheelSum = 0
  addEventListener('wheel', (e) => {
    const now = performance.now()
    if (now < wheelLock) return
    wheelSum += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (Math.abs(wheelSum) > 60) { go(cur + (wheelSum > 0 ? 1 : -1), true); wheelSum = 0; wheelLock = now + 1100 }
  }, { passive: true })
  // 手机左右滑
  let sx = 0, sy = 0, st = 0
  const stage = $('#stage')
  stage.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = performance.now() }, { passive: true })
  stage.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy
    if (performance.now() - st < 700 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) go(cur + (dx < 0 ? 1 : -1), true)
  }, { passive: true })
  let rz = 0
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { kline.resize(); orbit.resize(); bokeh.resize(); photo3d.resize(); $$('.tagline span[data-t]').forEach((w) => { w.style.width = '' }) }, 120) })

  // ---------------- Into the 0x4 过场（goat 喜欢的旧版效果搬回来） ----------------
  // 按钮处亮起一团光铺满屏幕，当前这页往前放大淡出，然后进网页版；网页版在同一位置接着把光散开（0x4.warp 记光心位置）。
  const intoHref = '/discover'   // 网页版的热门行情（2026-10-02 goat：进来先看行情，不是资产页）
  let prefetched = false
  const prefetch = () => { if (prefetched) return; prefetched = true; const l = document.createElement('link'); l.rel = 'prefetch'; l.href = intoHref; document.head.appendChild(l) }
  $$('a[data-into]').forEach((a) => {
    a.addEventListener('pointerenter', prefetch, { passive: true })
    a.addEventListener('focus', prefetch)
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      const href = a.getAttribute('href') || intoHref
      const r = a.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
      try { sessionStorage.setItem('0x4.warp', `${Math.round((cx / innerWidth) * 100)}% ${Math.round((cy / innerHeight) * 100)}%`) } catch { /* 隐私模式：直接跳 */ }
      if (reduce) { location.href = href; return }
      pause()
      const far = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy))
      const p = document.createElement('div')
      p.className = 'warp-portal'
      p.style.left = `${cx}px`; p.style.top = `${cy}px`
      p.style.setProperty('--s', String(Math.ceil((far * 2.3) / 80)))
      document.body.appendChild(p)
      document.documentElement.classList.add('warping')
      setTimeout(() => { location.href = href }, 740)
    })
  })
  // 从网页版按返回回来（浏览器从缓存恢复这一页）：把光和放大撤掉，轮播继续
  addEventListener('pageshow', (e) => { if (e.persisted) { document.documentElement.classList.remove('warping'); $$('.warp-portal').forEach((x) => x.remove()); resume() } })
  if ('requestIdleCallback' in window) requestIdleCallback(() => setTimeout(prefetch, 2500))

  scenes.forEach((s) => { s.setAttribute('aria-hidden', 'true'); s.inert = true })
  applyLang(lang)
  // 本机验收用：?s=3 从第 4 页开始，?hold 停在那一页不自动切
  const q = new URLSearchParams(location.search)
  go(Math.min(scenes.length - 1, Math.max(0, +q.get('s') || 0)))
  if (q.has('hold')) { clearTimeout(timer); timer = 0; schedule = () => {} }
})()
