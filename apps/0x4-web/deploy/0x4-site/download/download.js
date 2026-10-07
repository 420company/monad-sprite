// 下载页按钮（2026-10-03 从页面里挪出来：官网安全规则 script-src 'self' 不允许内嵌脚本，线上一直没显示按钮）
  // 按 links.js 填按钮：有地址 = 「点击下载」；没有 = 「即将开放」。两种语言都放进去，由 legal.css 按 <html lang> 只显示一份
  (function () {
    var cfg = window.OX4_DOWNLOADS || {}
    // 2026-10-03 goat：卡片只留图标 + 名字 + 一个按钮，按钮只有两种：点击下载 / 即将开放（审核中也显示即将开放）
    var label = {
      get: { en: 'Download', zh: '点击下载' },
      soon: { en: 'Coming soon', zh: '即将开放' },
    }
    var both = function (k) { return '<span data-lang-only="en">' + label[k].en + '</span><span data-lang-only="zh">' + label[k].zh + '</span>' }
    var cards = document.querySelectorAll('[data-dl]')
    for (var i = 0; i < cards.length; i++) {
      var c = cfg[cards[i].getAttribute('data-dl')] || {}
      var slot = cards[i].querySelector('[data-slot]')
      if (c.url && /^https:\/\//.test(c.url)) {
        var a = document.createElement('a')
        a.className = 'get'; a.href = c.url; a.target = '_blank'; a.rel = 'noopener'
        a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg>' + both('get')
        slot.appendChild(a)
      } else {
        var d = document.createElement('div')
        d.className = 'state soon'
        d.innerHTML = both('soon')
        slot.appendChild(d)
      }
    }
  })()
