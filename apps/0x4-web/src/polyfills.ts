// Browser environment polyfills: must be the entry file's first import, so they take effect before @solana/* and other libraries load
import { Buffer } from 'buffer'
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
