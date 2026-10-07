// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SpritePass - free Monad-testnet pass that unlocks the Zalien AI agent.
/// @notice Hackathon judges (or anyone) can mint one for free on Monad testnet.
///         The /agent gate accepts EITHER a Zalien (BNB Chain) OR a SpritePass (Monad).
///         Art is a fully on-chain SVG - no IPFS, no server.
contract SpritePass {
    string public constant name = "Monad Sprite Pass";
    string public constant symbol = "SPRITEPASS";

    uint256 public totalSupply;
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public hasMinted;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    error AlreadyMinted();
    error NonexistentToken();

    /// @notice Free mint, one per wallet. No allowlist - testnet.
    function mint() external returns (uint256 tokenId) {
        if (hasMinted[msg.sender]) revert AlreadyMinted();
        hasMinted[msg.sender] = true;
        tokenId = ++totalSupply;
        _ownerOf[tokenId] = msg.sender;
        balanceOf[msg.sender] += 1;
        emit Transfer(address(0), msg.sender, tokenId);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _ownerOf[tokenId];
        if (o == address(0)) revert NonexistentToken();
        return o;
    }

    /// @notice Metadata: reuses the real Zalien artwork hosted on api.zalien.io.
    ///         Token #N uses Zalien image #N - each Sprite Pass is visually unique.
    ///         Fully on-chain JSON, no IPFS pinning needed, no server changes.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_ownerOf[tokenId] == address(0)) revert NonexistentToken();
        string memory json = string(
            abi.encodePacked(
                '{"name":"Sprite Pass #',
                _toString(tokenId),
                '","description":"Unlocks the Zalien AI trading agent on Monad testnet. Free pass - one per wallet.",',
                '"image":"https://api.zalien.io/bsc/img/',
                _toString(tokenId),
                '.webp",',
                '"attributes":[{"trait_type":"Chain","value":"Monad Testnet"},{"trait_type":"Type","value":"Agent Pass"}]}'
            )
        );
        return string(abi.encodePacked('data:application/json;utf8,', json));
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        uint256 x = v;
        while (x > 0) { len++; x /= 10; }
        bytes memory b = new bytes(len);
        while (v > 0) { b[--len] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(b);
    }
}
