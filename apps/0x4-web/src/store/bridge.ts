// Cross-chain / flash-swap orders: persisted, and LI.FI status polled until done
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getLifiStatus } from '@/lib/lifi'

export type TransferStatus = 'PENDING' | 'DONE' | 'FAILED'

export interface Transfer {
  txHash: string
  fromChain: number
  toChain: number
  fromSymbol: string
  toSymbol: string
  fromAmount: number
  toAmount: number
  tool?: string
  status: TransferStatus
  substatus?: string
  receivingTxLink?: string
  explorerLink?: string
  createdAt: number
  updatedAt: number
}

interface BridgeState {
  transfers: Transfer[]
  add: (t: Omit<Transfer, 'status' | 'createdAt' | 'updatedAt'>) => void
  poll: (txHash: string) => Promise<void>
  pollAllPending: () => void
}

const pollers = new Map<string, ReturnType<typeof setTimeout>>()

export const useBridge = create<BridgeState>()(
  persist(
    (set, get) => ({
      transfers: [],

      add(t) {
        const now = Date.now()
        const entry: Transfer = { ...t, status: 'PENDING', createdAt: now, updatedAt: now }
        set({ transfers: [entry, ...get().transfers].slice(0, 100) })
        get().poll(t.txHash)
      },

      async poll(txHash) {
        const t = get().transfers.find((x) => x.txHash === txHash)
        if (!t || t.status !== 'PENDING') return
        try {
          const s = await getLifiStatus(txHash, t.fromChain, t.toChain, t.tool)
          const status: TransferStatus = s.status === 'DONE' ? 'DONE' : s.status === 'FAILED' ? 'FAILED' : 'PENDING'
          const receiving = 'receiving' in s && s.receiving && 'txLink' in s.receiving ? (s.receiving as { txLink?: string }).txLink : undefined
          const explorer = 'lifiExplorerLink' in s ? (s as { lifiExplorerLink?: string }).lifiExplorerLink : undefined
          set({
            transfers: get().transfers.map((x) =>
              x.txHash === txHash ? { ...x, status, substatus: s.substatus, receivingTxLink: receiving ?? x.receivingTxLink, explorerLink: explorer ?? x.explorerLink, updatedAt: Date.now() } : x,
            ),
          })
          if (status !== 'PENDING') return
        } catch {
          /* Network error: retry later */
        }
        // Stop polling after 2 hours unfinished — avoid infinite requests
        if (Date.now() - t.createdAt > 2 * 3600_000) return
        clearTimeout(pollers.get(txHash))
        pollers.set(txHash, setTimeout(() => get().poll(txHash), 10_000))
      },

      pollAllPending() {
        for (const t of get().transfers) if (t.status === 'PENDING' && !pollers.has(t.txHash)) get().poll(t.txHash)
      },
    }),
    { name: '0x4.transfers', partialize: (s) => ({ transfers: s.transfers }) },
  ),
)
