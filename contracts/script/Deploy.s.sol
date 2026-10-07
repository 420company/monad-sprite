// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {MemeLauncher} from "../src/MemeLauncher.sol";

/// @notice Deploy MemeLauncher. NOT run yet — deploy target (testnet vs mainnet) TBD.
///         Usage (when the team confirms): 
///           forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
contract Deploy is Script {
    function run() external returns (MemeLauncher) {
        vm.startBroadcast();
        MemeLauncher launcher = new MemeLauncher();
        vm.stopBroadcast();
        return launcher;
    }
}
