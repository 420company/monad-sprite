import { parseAbi } from 'viem';

/** Minimal MemeLauncher ABI — only what the scorer needs. */
export const launcherAbi = parseAbi([
  'function tokens(address token) external view returns (bool exists, uint256 supply, uint256 reserve, string name, string symbol)',
  'function tokenCount() external view returns (uint256)',
  'function allTokens(uint256 index) external view returns (address)',
  'function getPrice(address token) external view returns (uint256)',
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol)',
]);

/** Minimal ERC-20 ABI + common risk probes. */
export const erc20Abi = parseAbi([
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function owner() external view returns (address)',
  'function launcher() external view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
