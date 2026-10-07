// 法律页的语言切换 + 目录高亮（2026-10-01）。
// 语言和落地页共用同一个本地存储键，在首页选了中文，点进条款也是中文；没选过就按浏览器语言。
// 正文两种语言都在页面里，这里只切 <html lang> 和标题，不生成文字。
(function () {
  var LANG_KEY = '0x4.site.lang'
  var root = document.documentElement
  function pick() {
    var l = ''
    try { l = localStorage.getItem(LANG_KEY) || '' } catch (e) { /* 隐私模式读不到就按浏览器语言 */ }
    if (l !== 'zh' && l !== 'en') l = /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
    return l
  }
  function apply(l) {
    root.lang = l
    var t = root.getAttribute('data-title-' + l)
    if (t) document.title = t
    var btns = document.querySelectorAll('[data-lang]')
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-lang') === l))
  }
  apply(pick())
  // 窄屏目录默认收起（展开会占满第一屏），宽屏目录在左侧常显
  if (window.matchMedia && window.matchMedia('(max-width: 999px)').matches) {
    var ds = document.querySelectorAll('.toc details')
    for (var d = 0; d < ds.length; d++) ds[d].open = false
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lang]')
    if (!b) return
    var l = b.getAttribute('data-lang')
    try { localStorage.setItem(LANG_KEY, l) } catch (err) { /* 忽略 */ }
    apply(l)
  })

  // 目录高亮：看当前语言那份正文里哪一节在视口上方
  if (!('IntersectionObserver' in window)) return
  var current = null
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return
      var id = en.target.id
      if (current === id) return
      current = id
      var links = document.querySelectorAll('.toc a')
      for (var i = 0; i < links.length; i++) links[i].classList.toggle('on', links[i].getAttribute('href') === '#' + id)
    })
  }, { rootMargin: '-90px 0px -70% 0px' })
  var secs = document.querySelectorAll('.doc section[id]')
  for (var i = 0; i < secs.length; i++) io.observe(secs[i])
})()
