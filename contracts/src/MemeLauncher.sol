// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MemeToken} from "./MemeToken.sol";

/// @title MemeLauncher
/// @notice Hackathon MVP: one-click meme coin launcher with a linear bonding curve.
///         createToken() deploys a new ERC20; buy()/sell() trade along the curve;
///         getPrice() returns the current marginal price.
/// @dev Bonding curve: marginal price per whole token (wei) at supply s (base units) is
///      price(s) = BASE_PRICE + SLOPE * s / SUPPLY_SCALE.
///      Buys solve the quadratic cost integral for tokens-out given MON-in (with dust
///      refund); sells pay out along the same curve. Not audited — demo/testnet only.
contract MemeLauncher {
    // --- Bonding curve parameters ---
    uint256 public constant BASE_PRICE = 1e12; // 1e-6 MON per token at launch
    uint256 public constant SLOPE = 9e6; // price ramps ~10x per 1M tokens sold
    uint256 public constant SUPPLY_SCALE = 1e18;
    uint256 public constant TOKEN_UNIT = 1e18; // 18 decimals

    struct TokenInfo {
        bool exists;
        uint256 supply; // base units
        uint256 reserve; // wei of MON backing sells
        string name;
        string symbol;
    }

    mapping(address => TokenInfo) public tokens;
    address[] public allTokens;

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol);
    event Buy(address indexed token, address indexed buyer, uint256 monIn, uint256 tokensOut);
    event Sell(address indexed token, address indexed seller, uint256 tokensIn, uint256 monOut);

    error UnknownToken();
    error ZeroPayment();
    error AmountTooSmall();
    error InsufficientBalance();
    error InsufficientReserve();
    error TransferFailed();

    /// @notice Deploy a new meme token. Free to create (hackathon demo).
    function createToken(string calldata name, string calldata symbol) external returns (address token) {
        MemeToken t = new MemeToken(name, symbol);
        token = address(t);
        tokens[token] = TokenInfo({exists: true, supply: 0, reserve: 0, name: name, symbol: symbol});
        allTokens.push(token);
        emit TokenCreated(token, msg.sender, name, symbol);
    }

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice Marginal price per whole token (wei) at current supply.
    function getPrice(address token) public view returns (uint256) {
        TokenInfo storage info = _info(token);
        return BASE_PRICE + (SLOPE * info.supply) / SUPPLY_SCALE;
    }

    /// @notice Preview: tokens out for `monIn` wei.
    function quoteBuy(address token, uint256 monIn) public view returns (uint256) {
        return _quoteBuy(_info(token).supply, monIn);
    }

    /// @notice Exact wei cost to mint `tokenAmount` base units at current supply.
    function costToBuy(address token, uint256 tokenAmount) public view returns (uint256) {
        return _costToBuy(_info(token).supply, tokenAmount);
    }

    /// @notice Preview: wei payout for burning `tokenAmount` base units.
    function quoteSell(address token, uint256 tokenAmount) public view returns (uint256) {
        return _quoteSell(_info(token).supply, tokenAmount);
    }

    /// @notice Buy tokens along the bonding curve. Dust (msg.value - exact cost) is refunded.
    function buy(address token) external payable {
        TokenInfo storage info = _info(token);
        if (msg.value == 0) revert ZeroPayment();
        uint256 amountOut = _quoteBuy(info.supply, msg.value);
        if (amountOut == 0) revert AmountTooSmall();
        uint256 cost = _costToBuy(info.supply, amountOut);

        info.supply += amountOut;
        info.reserve += cost;
        MemeToken(token).mint(msg.sender, amountOut);

        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
        emit Buy(token, msg.sender, cost, amountOut);
    }

    /// @notice Sell tokens back along the bonding curve.
    function sell(address token, uint256 tokenAmount) external {
        TokenInfo storage info = _info(token);
        if (tokenAmount == 0) revert AmountTooSmall();
        if (MemeToken(token).balanceOf(msg.sender) < tokenAmount) revert InsufficientBalance();
        uint256 payout = _quoteSell(info.supply, tokenAmount);
        if (payout == 0) revert AmountTooSmall();
        if (payout > info.reserve) revert InsufficientReserve();

        MemeToken(token).burnFrom(msg.sender, tokenAmount);
        info.supply -= tokenAmount;
        info.reserve -= payout;

        (bool ok,) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();
        emit Sell(token, msg.sender, tokenAmount, payout);
    }

    // --- internals ---

    function _info(address token) internal view returns (TokenInfo storage info) {
        info = tokens[token];
        if (!info.exists) revert UnknownToken();
    }

    /// @dev Tokens out for V wei from supply S.
    ///      Solves SLOPE*d^2 + 2*(SUPPLY_SCALE*BASE_PRICE + SLOPE*S)*d
    ///             - 2*SUPPLY_SCALE*TOKEN_UNIT*V = 0 for d.
    function _quoteBuy(uint256 supply, uint256 monIn) internal pure returns (uint256) {
        uint256 b = 2 * (SUPPLY_SCALE * BASE_PRICE + SLOPE * supply);
        uint256 disc = b * b + 8 * SLOPE * SUPPLY_SCALE * TOKEN_UNIT * monIn;
        return (sqrt(disc) - b) / (2 * SLOPE);
    }

    /// @dev Exact wei cost to mint `amount` base units from supply S.
    function _costToBuy(uint256 supply, uint256 amount) internal pure returns (uint256) {
        uint256 curve = (SLOPE * (supply * amount + (amount * amount) / 2)) / SUPPLY_SCALE;
        return (BASE_PRICE * amount + curve) / TOKEN_UNIT;
    }

    /// @dev Wei payout for burning `amount` base units from supply S (S >= amount).
    function _quoteSell(uint256 supply, uint256 amount) internal pure returns (uint256) {
        uint256 curve = (SLOPE * (supply * amount - (amount * amount) / 2)) / SUPPLY_SCALE;
        return (BASE_PRICE * amount + curve) / TOKEN_UNIT;
    }

    /// @dev Integer square root (Babylonian method), rounds down.
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
