// 常用代币地址表：只提供真实主网地址供接口去拉行情，这里的数值字段不会展示给用户
import type { MarketToken } from './types'

export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const img = (mint: string) => `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png`

const solChain = { chain: 'solana', chainId: 1151111081099710 }
export const MOCK_TOKENS: MarketToken[] = [
  { ...solChain, address: SOL_MINT, symbol: 'SOL', name: 'Solana', logo: img(SOL_MINT), decimals: 9, priceUsd: 214.32, change5m: 0.12, change1h: -0.4, change6h: 1.8, change24h: 3.6, volume24h: 2_540_000_000, liquidityUsd: 900_000_000, marketCap: 116_000_000_000, fdv: 130_000_000_000, buys24h: 412000, sells24h: 398000 },
  { ...solChain, address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', logo: img('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'), decimals: 6, priceUsd: 0.92, change5m: 0.3, change1h: 1.2, change6h: 2.5, change24h: 6.1, volume24h: 120_000_000, liquidityUsd: 40_000_000, marketCap: 2_800_000_000, fdv: 9_200_000_000, buys24h: 32000, sells24h: 29000 },
  { ...solChain, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', logo: img('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), decimals: 5, priceUsd: 0.0000241, change5m: -0.5, change1h: -2.1, change6h: 4.4, change24h: 12.8, volume24h: 310_000_000, liquidityUsd: 25_000_000, marketCap: 1_900_000_000, fdv: 2_100_000_000, buys24h: 88000, sells24h: 74000 },
  { ...solChain, address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat', logo: img('EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'), decimals: 6, priceUsd: 1.84, change5m: 0.8, change1h: 3.2, change6h: -1.1, change24h: -4.7, volume24h: 260_000_000, liquidityUsd: 30_000_000, marketCap: 1_840_000_000, fdv: 1_840_000_000, buys24h: 51000, sells24h: 56000 },
  { ...solChain, address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', name: 'Popcat', logo: img('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'), decimals: 9, priceUsd: 0.63, change5m: 1.9, change1h: 5.6, change6h: 9.3, change24h: 24.5, volume24h: 95_000_000, liquidityUsd: 12_000_000, marketCap: 617_000_000, fdv: 617_000_000, buys24h: 27000, sells24h: 21000 },
  { ...solChain, address: 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn', symbol: 'PUMP', name: 'Pump', logo: img('pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn'), decimals: 6, priceUsd: 0.0061, change5m: -1.2, change1h: -3.8, change6h: -6.2, change24h: -11.4, volume24h: 180_000_000, liquidityUsd: 60_000_000, marketCap: 2_150_000_000, fdv: 6_100_000_000, buys24h: 44000, sells24h: 52000 },
  { ...solChain, address: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', symbol: 'TRUMP', name: 'OFFICIAL TRUMP', logo: img('6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'), decimals: 6, priceUsd: 7.42, change5m: 0.1, change1h: 0.9, change6h: -0.6, change24h: 2.2, volume24h: 210_000_000, liquidityUsd: 80_000_000, marketCap: 1_480_000_000, fdv: 7_400_000_000, buys24h: 36000, sells24h: 33000 },
  { ...solChain, address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', logo: img('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'), decimals: 6, priceUsd: 3.15, change5m: 0.2, change1h: 0.4, change6h: 1.1, change24h: 5.3, volume24h: 60_000_000, liquidityUsd: 35_000_000, marketCap: 920_000_000, fdv: 1_740_000_000, buys24h: 12000, sells24h: 11000 },
  { ...solChain, address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', symbol: 'JTO', name: 'Jito', logo: img('jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL'), decimals: 9, priceUsd: 2.06, change5m: -0.1, change1h: -0.8, change6h: 0.5, change24h: 1.9, volume24h: 40_000_000, liquidityUsd: 18_000_000, marketCap: 720_000_000, fdv: 2_060_000_000, buys24h: 8000, sells24h: 7600 },
  // EVM 链示例币（Base 上的 BRETT）
  { chain: 'base', chainId: 8453, address: '0x532f27101965dd16442E59d40670FaF5eBB142E4', symbol: 'BRETT', name: 'Brett', logo: 'https://dd.dexscreener.com/ds-data/tokens/base/0x532f27101965dd16442e59d40670faf5ebb142e4.png', decimals: 18, priceUsd: 0.052, change5m: 0.4, change1h: 2.1, change6h: -1.3, change24h: 8.7, volume24h: 14_000_000, liquidityUsd: 9_000_000, marketCap: 515_000_000, fdv: 515_000_000, buys24h: 6100, sells24h: 5400 },
  { ...solChain, address: USDC_MINT, symbol: 'USDC', name: 'USD Coin', logo: img(USDC_MINT), decimals: 6, priceUsd: 1.0, change5m: 0, change1h: 0, change6h: 0.01, change24h: -0.01, volume24h: 3_100_000_000, liquidityUsd: 1_500_000_000, marketCap: 9_800_000_000, fdv: 9_800_000_000, buys24h: 500000, sells24h: 500000 },
]


