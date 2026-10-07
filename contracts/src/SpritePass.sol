// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SpritePass — free Monad-testnet pass that unlocks the Zalien AI agent.
/// @notice Hackathon judges (or anyone) can mint one for free on Monad testnet.
///         The /agent gate accepts EITHER a Zalien (BNB Chain) OR a SpritePass (Monad).
///         Art is a fully on-chain SVG — no IPFS, no server.
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

    /// @notice Free mint, one per wallet. No allowlist — testnet.
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

    /// @notice On-chain SVG metadata (data URI, no external deps).
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_ownerOf[tokenId] == address(0)) revert NonexistentToken();
        string memory svg = string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">',
                '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
                '<stop offset="0%" stop-color="#2a1a4a"/><stop offset="100%" stop-color="#0f2a3a"/>',
                '</linearGradient></defs>',
                '<rect width="400" height="400" rx="24" fill="url(#g)"/>',
                unicode'<text x="200" y="190" font-size="120" text-anchor="middle">🤖</text>',
                '<text x="200" y="280" font-size="28" fill="#fff" text-anchor="middle" font-family="sans-serif" font-weight="bold">SPRITE PASS</text>',
                '<text x="200" y="312" font-size="16" fill="#a0a0c0" text-anchor="middle" font-family="sans-serif">#',
                _toString(tokenId),
                unicode' · Monad Testnet</text>',
                '</svg>'
            )
        );
        string memory json = string(
            abi.encodePacked(
                '{"name":"Sprite Pass #',
                _toString(tokenId),
                '","description":"Unlocks the Zalien AI trading agent on monad-sprite. Free Monad testnet pass.",',
                '"image":"data:image/svg+xml;base64,',
                _base64(bytes(svg)),
                '"}'
            )
        );
        return string(abi.encodePacked('data:application/json;base64,', _base64(bytes(json))));
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

    // Minimal base64 (no OZ dependency — keeps the hackathon repo lean)
    string internal constant _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function _base64(bytes memory data) internal pure returns (string memory) {
        uint256 n = data.length;
        uint256 outLen = 4 * ((n + 2) / 3);
        bytes memory out = new bytes(outLen);
        bytes memory table = bytes(_B64);
        uint256 i;
        uint256 j;
        for (i = 0; i < n;) {
            uint256 a = uint8(data[i++]);
            uint256 b = i < n ? uint8(data[i++]) : 0;
            uint256 c = i < n ? uint8(data[i++]) : 0;
            uint256 triple = (a << 16) | (b << 8) | c;
            out[j++] = table[(triple >> 18) & 63];
            out[j++] = table[(triple >> 12) & 63];
            out[j++] = table[(triple >> 6) & 63];
            out[j++] = table[triple & 63];
        }
        uint256 mod = n % 3;
        if (mod == 1) { out[outLen - 1] = '='; out[outLen - 2] = '='; }
        else if (mod == 2) { out[outLen - 1] = '='; }
        return string(out);
    }
}
