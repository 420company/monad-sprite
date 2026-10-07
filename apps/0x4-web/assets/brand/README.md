# 0x4 图标母版

2026-09-25 改名 0x4 后换成猫头：圆脸两只耳朵，0 和 4 是眼睛、小 x 是嘴（0x4 本身就是猫脸颜文字）。脸用珍珠极光渐变（蜜桃 → 淡紫 → 冰青），底板深色带两团柔光。旧的「描边 4F」已弃用。

- `icon.svg`：带圆角底板，网页和 App 内用（复制到 `public/icons/icon.svg`）
- `icon-square.svg`：无圆角，iOS 图标源（系统自己切圆角）
- `icon-foreground.svg`：透明底只有图形，Android 自适应图标前景（缩到安全区内）
- `splash.svg`：启动图

改了母版后重新出图：
```sh
rsvg-convert -w 1024 -h 1024 assets/brand/icon-square.svg -o assets/icon.png
rsvg-convert -w 1024 -h 1024 assets/brand/icon-foreground.svg -o assets/icon-foreground.png
rsvg-convert -w 2732 -h 2732 assets/brand/splash.svg -o assets/splash.png && cp assets/splash.png assets/splash-dark.png
npx @capacitor/assets generate --iconBackgroundColor '#0c0e13' --iconBackgroundColorDark '#0c0e13' --splashBackgroundColor '#0c0e13' --splashBackgroundColorDark '#0c0e13'
rm -rf icons public/manifest.webmanifest   # 生成器顺手出的网页图标用不上，manifest 由 vite-plugin-pwa 生成
```
