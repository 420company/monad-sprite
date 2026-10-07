// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script} from "forge-std/Script.sol";
import {SpritePass} from "../src/SpritePass.sol";
contract DeploySpritePass is Script {
    function run() external returns (SpritePass) {
        vm.startBroadcast();
        SpritePass p = new SpritePass();
        vm.stopBroadcast();
        return p;
    }
}
