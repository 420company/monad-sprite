// @vitest-environment jsdom
// Mainnet-fork end-to-end (2026-09-25 goat: "test the whole flow — moving tokens across two chains, buying and selling").
//
// Skipped normally; to run, start two anvil forks first, then pass the env vars:
//   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8645 --chain-id 4663
//   anvil --fork-url https://bsc-rpc.publicnode.com          --port 8646 --chain-id 56
//   FORK=1 VITE_EVM_RPC_4663=http://127.0.0.1:8645 VITE_EVM_RPC_56=http://127.0.0.1:8646 npx vitest run src/lib/flows.fork.test.ts
//
// Runs the app's real functions throughout: getLifiQuote (real LI.FI quote) → executeLifiStep (approve + send), transferEvm (transfer).
// A fork only proves "the source-side tx truly executes and funds truly move". Arrival on the other side of the bridge depends on the bridge's off-chain service — not simulatable locally; verify with real money.
// ⚠️ Use a freshly generated private key for the test wallet — never anvil's default publicized key: on mainnet it's already 7702-delegated to a sweeper contract, and anything sent in gets swept.
import { describe, expect, it } from 'vitest'
import { createPublicClient, erc20Abi, http, parseEther, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getLifiQuote, executeLifiStep } from './lifi'
import { transferEvm } from './transfer'
import { NATIVE_EVM } from './chains'

const RH = 4663, BSC = 56
const RH_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955'
const env = import.meta.env as Record<string, string | undefined>
const rpc = (id: number) => env[`VITE_EVM_RPC_${id}`]!
const run = !!process.env.FORK

const me = privateKeyToAccount(generatePrivateKey())
const friend = privateKeyToAccount(generatePrivateKey()).address

async function call(id: number, method: string, params: unknown[]) {
  const r = await fetch(rpc(id), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  return (await r.json()).result
}
const client = (id: number) => createPublicClient({ transport: http(rpc(id)) })
const native = (id: number, a: string) => client(id).getBalance({ address: a as Hex })
const erc20 = (id: number, token: string, a: string) => client(id).readContract({ address: token as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [a as Hex] })
const signers = { solana: null, evm: me, solanaRpc: '' }

/** Quote + execute; returns the source-chain transaction receipt */
async function swap(fromChain: number, fromToken: string, toChain: number, toToken: string, amount: bigint) {
  const step = await getLifiQuote({ fromChain, fromToken, toChain, toToken, fromAmount: amount, fromAddress: me.address, toAddress: me.address, slippage: 0.01 })
  const phases: string[] = []
  const hash = await executeLifiStep(step, signers, (p) => phases.push(p))
  const receipt = await client(fromChain).waitForTransactionReceipt({ hash: hash as Hex })
  return { step, receipt, phases }
}

describe.skipIf(!run)('主网分叉：Robinhood 链 / BNB Chain 转币与买卖', () => {
  it('准备：给测试钱包打 gas（分叉上凭空设置余额）', async () => {
    await call(RH, 'anvil_setBalance', [me.address, '0x' + parseEther('1').toString(16)])
    await call(BSC, 'anvil_setBalance', [me.address, '0x' + parseEther('5').toString(16)])
    expect(await native(RH, me.address)).toBe(parseEther('1'))
  })

  it('Robinhood：ETH 买 USDG（同链买币）', async () => {
    const before = await erc20(RH, RH_USDG, me.address)
    const { receipt, step } = await swap(RH, NATIVE_EVM, RH, RH_USDG, parseEther('0.05'))
    expect(receipt.status).toBe('success')
    const got = (await erc20(RH, RH_USDG, me.address)) - before
    console.log(`RH 买：0.05 ETH → ${Number(got) / 1e6} USDG（报价 ${Number(step.estimate.toAmount) / 1e6}，路线 ${step.toolDetails.name}）`)
    expect(got).toBeGreaterThan(0n)
  }, 120_000)

  it('Robinhood：USDG 卖成 ETH（要先授权）', async () => {
    const usdg = await erc20(RH, RH_USDG, me.address)
    const eth0 = await native(RH, me.address)
    const { receipt, phases, step } = await swap(RH, RH_USDG, RH, NATIVE_EVM, usdg / 3n)
    expect(receipt.status).toBe('success')
    expect(phases).toContain('approving')
    console.log(`RH 卖：${Number(usdg / 3n) / 1e6} USDG → ETH（路线 ${step.toolDetails.name}，经过授权：${phases.join(' → ')}）`)
    expect(await erc20(RH, RH_USDG, me.address)).toBeLessThan(usdg)
    expect(await native(RH, me.address)).toBeGreaterThan(eth0 - parseEther('0.001')) // The reclaimed ETH covers gas with room to spare
  }, 120_000)

  it('Robinhood：转 USDG 和 ETH 给别人', async () => {
    const h1 = await transferEvm(me, { chainId: RH, token: RH_USDG, to: friend, amount: '1', decimals: 6 })
    await client(RH).waitForTransactionReceipt({ hash: h1 as Hex })
    const h2 = await transferEvm(me, { chainId: RH, token: NATIVE_EVM, to: friend, amount: '0.001', decimals: 18 })
    await client(RH).waitForTransactionReceipt({ hash: h2 as Hex })
    expect(await erc20(RH, RH_USDG, friend)).toBe(1_000_000n)
    expect(await native(RH, friend)).toBe(parseEther('0.001'))
  }, 120_000)

  it('Robinhood USDG → BNB Chain USDT（跨链，只验源链这一侧）', async () => {
    const usdg = await erc20(RH, RH_USDG, me.address)
    const { receipt, step } = await swap(RH, RH_USDG, BSC, BSC_USDT, usdg / 2n)
    expect(receipt.status).toBe('success')
    console.log(`跨链 RH→BSC：${Number(usdg / 2n) / 1e6} USDG，预计到账 ${Number(step.estimate.toAmount) / 1e18} USDT，路线 ${step.toolDetails.name}，约 ${step.estimate.executionDuration} 秒`)
    expect(await erc20(RH, RH_USDG, me.address)).toBeLessThanOrEqual(usdg - usdg / 2n)
  }, 120_000)

  it('BNB Chain：BNB 买 USDT、USDT 卖回 BNB', async () => {
    const buy = await swap(BSC, NATIVE_EVM, BSC, BSC_USDT, parseEther('0.2'))
    expect(buy.receipt.status).toBe('success')
    const usdt = await erc20(BSC, BSC_USDT, me.address)
    console.log(`BSC 买：0.2 BNB → ${Number(usdt) / 1e18} USDT（路线 ${buy.step.toolDetails.name}）`)
    expect(usdt).toBeGreaterThan(0n)
    const sell = await swap(BSC, BSC_USDT, BSC, NATIVE_EVM, usdt / 3n)
    expect(sell.receipt.status).toBe('success')
    expect(sell.phases).toContain('approving')
    console.log(`BSC 卖：${Number(usdt / 3n) / 1e18} USDT → BNB（路线 ${sell.step.toolDetails.name}）`)
  }, 180_000)

  it('BNB Chain：转 USDT 和 BNB 给别人', async () => {
    const h1 = await transferEvm(me, { chainId: BSC, token: BSC_USDT, to: friend, amount: '1', decimals: 18 })
    await client(BSC).waitForTransactionReceipt({ hash: h1 as Hex })
    const h2 = await transferEvm(me, { chainId: BSC, token: NATIVE_EVM, to: friend, amount: '0.01', decimals: 18 })
    await client(BSC).waitForTransactionReceipt({ hash: h2 as Hex })
    expect(await erc20(BSC, BSC_USDT, friend)).toBe(parseEther('1'))
    expect(await native(BSC, friend)).toBe(parseEther('0.01'))
  }, 120_000)

  it('BNB Chain USDT → Robinhood USDG（跨链，只验源链这一侧）', async () => {
    const usdt = await erc20(BSC, BSC_USDT, me.address)
    const { receipt, step } = await swap(BSC, BSC_USDT, RH, RH_USDG, usdt / 2n)
    expect(receipt.status).toBe('success')
    console.log(`跨链 BSC→RH：${Number(usdt / 2n) / 1e18} USDT，预计到账 ${Number(step.estimate.toAmount) / 1e6} USDG，路线 ${step.toolDetails.name}`)
  }, 120_000)
})
