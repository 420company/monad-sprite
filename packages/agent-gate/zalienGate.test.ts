/**
 * Live test for zalienGate.ts — hits BSC mainnet public RPC (read-only).
 * Run: npm test   (node zalienGate.test.ts)
 */
import { checkZalienHolder, isZalienHolder, verifyCollection, ZALIEN_CONTRACT } from "./zalienGate.ts";

const KNOWN_HOLDER = "0x4695F0ea37337d627AF1A42A8F33F3c78F08D000"; // holds Zaliens on BSC
const KNOWN_EMPTY = "0x000000000000000000000000000000000000dEaD"; // burn address, holds none

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}${extra}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra}`);
  }
}

// 1. collection sanity
const meta = await verifyCollection();
ok("collection name == Zalien", meta.name === "Zalien", ` (got "${meta.name}")`);
ok("collection symbol == ZALIEN", meta.symbol === "ZALIEN", ` (got "${meta.symbol}")`);
ok("contract matches zalien.io config", meta.contract.toLowerCase() === ZALIEN_CONTRACT.toLowerCase());

// 2. known holder -> holder:true, count>=1
const h = await checkZalienHolder(KNOWN_HOLDER);
ok("known holder detected", h.holder === true && h.count >= 1, ` (count=${h.count})`);
ok("holder wallet checksummed", h.wallet === KNOWN_HOLDER);

// 3. empty wallet -> holder:false, count:0
const e = await checkZalienHolder(KNOWN_EMPTY);
ok("empty wallet not holder", e.holder === false && e.count === 0, ` (count=${e.count})`);

// 4. boolean helper
ok("isZalienHolder true", (await isZalienHolder(KNOWN_HOLDER)) === true);
ok("isZalienHolder false", (await isZalienHolder(KNOWN_EMPTY)) === false);

// 5. malformed address throws
let threw = false;
try {
  await checkZalienHolder("not-an-address");
} catch {
  threw = true;
}
ok("malformed address throws", threw);

// 6. lowercase input gets checksummed
const lower = await checkZalienHolder(KNOWN_HOLDER.toLowerCase());
ok("lowercase input normalized", lower.holder === true && lower.wallet === KNOWN_HOLDER);

// 7. SpritePass: deployer minted one -> checkAgentAccess via spritepass
import { checkAgentAccess, checkSpritePassHolder } from "./zalienGate.ts";
const DEPLOYER = "0x68265d87d328Ee9358a2a2b646edF278422AFEF2"; // minted SpritePass #1
const passBal = await checkSpritePassHolder(DEPLOYER);
ok("deployer holds SpritePass", passBal >= 1, ` (balance=${passBal})`);
const acc = await checkAgentAccess(DEPLOYER);
ok("deployer unlocked via spritepass", acc.holder === true && acc.via === "spritepass", ` (via=${acc.via})`);
const acc2 = await checkAgentAccess(KNOWN_HOLDER);
ok("zalien holder still unlocked via zalien", acc2.holder === true && acc2.via === "zalien", ` (via=${acc2.via})`);
const acc3 = await checkAgentAccess(KNOWN_EMPTY);
ok("empty wallet stays locked", acc3.holder === false && acc3.via === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
