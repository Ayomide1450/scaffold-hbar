// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockERC20 } from "./MockERC20.sol";

/// @dev Minimal AMM double for unit tests. Simulates a 5% pool fee so the
///      contract holds ~95% of the input when buying. Mints the output token
///      to the recipient so the full swap-to-withdraw path is exercised.
contract MockSaucerSwapRouter {
    address public immutable whbar;

    constructor(address _whbar) {
        whbar = _whbar;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) public pure returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        uint256 _amountOut = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            _amountOut = (_amountOut * 95) / 100;
            amounts[i] = _amountOut;
        }
    }

    function swapExactETHForTokens(
        uint256 _amountOutMin,
        address[] calldata path,
        address to,
        uint256 _deadline
    ) external payable returns (uint256[] memory amounts) {
        require(path[0] == whbar, "INVALID_PATH");
        require(_deadline >= block.timestamp, "EXPIRED");
        amounts = getAmountsOut(msg.value, path);
        require(amounts[amounts.length - 1] >= _amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        MockERC20(path[path.length - 1]).mint(to, amounts[amounts.length - 1]);
    }
}