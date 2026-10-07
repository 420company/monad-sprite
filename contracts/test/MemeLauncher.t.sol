// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MemeLauncher} from "../src/MemeLauncher.sol";
import {MemeToken} from "../src/MemeToken.sol";

contract MemeLauncherTest is Test {
    MemeLauncher launcher;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        launcher = new MemeLauncher();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function testCreateToken() public {
        address token = launcher.createToken("Degen Cat", "DCAT");
        assertTrue(token != address(0));
        assertEq(launcher.tokenCount(), 1);
        assertEq(MemeToken(token).name(), "Degen Cat");
        assertEq(MemeToken(token).symbol(), "DCAT");
        assertEq(MemeToken(token).decimals(), 18);
        // price at zero supply == base price
        assertEq(launcher.getPrice(token), launcher.BASE_PRICE());
    }

    function testBuyMintsQuotedAmount() public {
        address token = launcher.createToken("Degen Cat", "DCAT");
        uint256 quoted = launcher.quoteBuy(token, 1 ether);
        assertGt(quoted, 0);
        uint256 cost = launcher.costToBuy(token, quoted);
        assertLe(cost, 1 ether); // never overcharge

        vm.prank(alice);
        launcher.buy{value: 1 ether}(token);

        assertEq(MemeToken(token).balanceOf(alice), quoted);
        assertEq(MemeToken(token).totalSupply(), quoted);

        (bool exists, uint256 supply, uint256 reserve,,) = launcher.tokens(token);
        assertTrue(exists);
        assertEq(supply, quoted);
        assertEq(reserve, cost);
        // price moved up along the curve
        assertGt(launcher.getPrice(token), launcher.BASE_PRICE());
    }

    function testSecondBuyGetsFewerTokensPerMon() public {
        address token = launcher.createToken("Degen Cat", "DCAT");
        vm.prank(alice);
        launcher.buy{value: 1 ether}(token);
        uint256 first = MemeToken(token).balanceOf(alice);

        vm.prank(bob);
        launcher.buy{value: 1 ether}(token);
        uint256 second = MemeToken(token).balanceOf(bob);

        assertLt(second, first); // bonding curve: later buyers get fewer tokens
    }

    function testSellPaysOutAndBurns() public {
        address token = launcher.createToken("Degen Cat", "DCAT");
        vm.prank(alice);
        launcher.buy{value: 1 ether}(token);
        uint256 bal = MemeToken(token).balanceOf(alice);

        uint256 quotedPayout = launcher.quoteSell(token, bal / 2);
        assertGt(quotedPayout, 0);

        uint256 ethBefore = alice.balance;
        vm.prank(alice);
        launcher.sell(token, bal / 2);

        assertEq(alice.balance - ethBefore, quotedPayout);
        assertEq(MemeToken(token).balanceOf(alice), bal - bal / 2);

        (, uint256 supply,,,) = launcher.tokens(token);
        assertEq(supply, bal - bal / 2);
    }

    function testFullSellRoundTrip() public {
        address token = launcher.createToken("Degen Cat", "DCAT");
        vm.prank(alice);
        launcher.buy{value: 1 ether}(token);
        uint256 bal = MemeToken(token).balanceOf(alice);

        uint256 payout = launcher.quoteSell(token, bal);
        assertLe(payout, 1 ether); // can't extract more than paid in

        vm.prank(alice);
        launcher.sell(token, bal);

        assertEq(MemeToken(token).balanceOf(alice), 0);
        assertEq(MemeToken(token).totalSupply(), 0);
        (, uint256 supply,,,) = launcher.tokens(token);
        assertEq(supply, 0);
    }

    function testBuyZeroReverts() public {
        address token = launcher.createToken("Degen Cat", "DCAT");
        vm.prank(alice);
        vm.expectRevert(MemeLauncher.ZeroPayment.selector);
        launcher.buy{value: 0}(token);
    }

    function testSellWithoutBalanceReverts() public {
        address token = launcher.createToken("Degen Cat", "DCAT");
        vm.prank(alice);
        vm.expectRevert(MemeLauncher.InsufficientBalance.selector);
        launcher.sell(token, 1 ether);
    }

    function testUnknownTokenReverts() public {
        vm.expectRevert(MemeLauncher.UnknownToken.selector);
        launcher.getPrice(address(0xDEAD));
        vm.expectRevert(MemeLauncher.UnknownToken.selector);
        launcher.quoteBuy(address(0xDEAD), 1 ether);
    }

    function testFuzzBuySellRoundTrip(uint256 monIn) public {
        monIn = bound(monIn, 0.001 ether, 10 ether);
        address token = launcher.createToken("Fuzz", "FZ");

        vm.prank(alice);
        launcher.buy{value: monIn}(token);
        uint256 bal = MemeToken(token).balanceOf(alice);
        assertGt(bal, 0);

        uint256 payout = launcher.quoteSell(token, bal);
        assertLe(payout, monIn);

        vm.prank(alice);
        launcher.sell(token, bal);

        (, uint256 supply,,,) = launcher.tokens(token);
        assertEq(supply, 0);
        assertEq(MemeToken(token).totalSupply(), 0);
    }
}
