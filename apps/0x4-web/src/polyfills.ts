// 浏览器环境垫片：必须作为入口文件的第一个 import，保证在 @solana/* 等库加载前生效
import { Buffer } from 'buffer'
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
