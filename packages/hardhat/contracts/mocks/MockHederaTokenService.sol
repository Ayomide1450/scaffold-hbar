// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Stand-in for the Hedera Token Service precompile at 0x167 for hermetic
///      unit tests. Mirrors the real `associateToken` response codes (22 = OK).
contract MockHederaTokenService {
    // solhint-disable-next-line no-unused-vars
    function associateToken(address account, address token) external pure returns (int64 responseCode) {
        return 22;
    }
}