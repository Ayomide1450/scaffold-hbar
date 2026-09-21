// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Hedera Token Service precompile (HTS) address.
address constant HTS_PRECOMPILE_ADDRESS = address(0x0000000000000000000000000000000000000167);

// HAPI ResponseCodeEnum.OK (22) — the only success code treated as idempotent.
int64 constant HAPI_OK = 22;

// HAPI ResponseCodeEnum.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT (23) — fine on re-association.
int64 constant HAPI_ALREADY_ASSOCIATED = 23;

interface ISaucerSwapV1Router {
    /// @notice UniswapV2-style `getAmountsOut`: returns expected output per hop for `amountIn`.
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    /// @notice Swaps exact native HBAR for output tokens. `amountOutMin` is in output-token units.
    /// @dev Named `swapExactETHForTokens` on the SaucerSwap fork (HBAR is the "ETH"); see
    ///      https://docs.saucerswap.finance/developers/v1/swap/swap-hbar-for-tokens
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);
}

interface IHederaTokenServiceMinimal {
    /// @dev Associates `account` with `token` via the HTS precompile. Returns a HAPI response code.
    function associateToken(address account, address token) external returns (int64 responseCode);
}

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title RecurringBuy
 * @notice On-chain Dollar-Cost Averaging (DCA) executor on Hedera.
 *
 * Users open a "stream" that swaps a fixed amount of native HBAR into an HTS
 * token (e.g. SAUCE) on a fixed cadence through the SaucerSwap V1 DEX. This is a
 * fully autonomous, permissionless "set and forget" schedule:
 *
 *  - The stream is pre-funded in HBAR. Each executed cadence spends exactly
 *    `buyAmountTinybar` tinybars through SaucerSwap's `swapExactETHForTokens`
 *    (the router wraps native HBAR into WHBAR and routes the AMM swap).
 *  - Any account ("keeper") can call `executeById` after the cadence has elapsed,
 *    so the stream keeps running even if the owner is away.
 *  - Slippage is bounded per stream (`maxSlippageBps`). The minimum output is
 *    derived from the router's own `getAmountsOut` quote, so the swap cannot be
 *    sandwiched beyond the configured tolerance.
 *  - Purchased tokens accumulate on the contract and are withdrawn by the owner
 *    with `withdraw`. Unspent HBAR is returned with `closeStream`.
 *
 * The SaucerSwap router is the single source of truth for pricing: no prices are
 * stored, read from oracles, or hardcoded anywhere in this contract. Removing the
 * SaucerSwap integration would make the entire template unable to execute a buy.
 */
contract RecurringBuy {
    /// @notice Smallest allowed cadence: 1 minute (keeps a 3s block cadence sane on testnet).
    uint256 public constant MIN_CADENCE_SECONDS = 60;

    /// @notice Cap on slippage (5%) so users cannot silently approve an extreme quote.
    uint256 public constant MAX_SLIPPAGE_BPS = 500;

    /// @notice Scale for `maxSlippageBps` (10000 = 100%).
    uint256 public constant BPS = 10_000;

    /// @notice Upper bound on swap deadlines relative to `block.timestamp`.
    uint256 public constant MAX_DEADLINE_LOOKAHEAD_SECONDS = 3600;

    struct Stream {
        address owner;
        address tokenOut;
        uint256 buyAmountTinybar;
        uint256 cadenceSeconds;
        uint256 maxSlippageBps;
        uint256 maxCadences; // 0 = unlimited
        uint256 executedCadences;
        uint256 lastExecutionAt;
        uint256 nextExecutionAt;
        uint256 fundedTinybar; // HBAR escrowed for future cadences
        bool isPaused;
    }

    /// @notice Router (SaucerSwapV1RouterV3) this contract executes against.
    address public immutable router;

    /// @notice WHBAR address used as the first hop of every swap path.
    address public immutable whbar;

    /// @notice Active stream id counter (1-based).
    uint256 public streamCount;

    /// @notice streamId => stream.
    mapping(uint256 => Stream) public streams;

    /// @notice streamId => outstanding token balance still owned by the stream owner.
    mapping(uint256 => mapping(address => uint256)) private _accrued;

    event StreamCreated(
        uint256 indexed streamId,
        address indexed owner,
        address tokenOut,
        uint256 buyAmountTinybar,
        uint256 cadenceSeconds,
        uint256 maxSlippageBps,
        uint256 maxCadences
    );

    event StreamPaused(uint256 indexed streamId);
    event StreamResumed(uint256 indexed streamId);
    event StreamClosed(uint256 indexed streamId, uint256 refundedTinybar);

    /// @notice Emitted once per executed cadence with the DEX-provided amounts (tinybars in, token units out).
    event CadenceExecuted(
        uint256 indexed streamId,
        uint256 indexed sequence,
        uint256 buyAmountTinybar,
        uint256 amountOut,
        address tokenOut
    );

    event TokensWithdrawn(uint256 indexed streamId, address indexed owner, address tokenOut, uint256 amount);

    error InvalidRouter();
    error InvalidToken();
    error ZeroBuyAmount();
    error CadenceTooShort();
    error SlippageTooHigh();
    error StreamNotFound(uint256 streamId);
    error NotStreamOwner(uint256 streamId, address caller);
    error StreamIsPaused(uint256 streamId);
    error StreamNotDue(uint256 streamId, uint256 nextExecutionAt);
    error InsufficientFunds(uint256 streamId, uint256 fundedTinybar, uint256 buyAmountTinybar);
    error SwapFailed(bytes reason);
    error TokenAssociationFailed(address tokenOut, int64 responseCode);
    error TokenTransferFailed();
    error NothingToWithdraw(uint256 streamId, address tokenOut);

    constructor(address _router, address _whbar) {
        if (_router == address(0)) revert InvalidRouter();
        if (_whbar == address(0)) revert InvalidToken();
        router = _router;
        whbar = _whbar;
    }

    /**
     * @notice Open a new recurring buy stream.
     * @dev Pre-funds exactly `maxCadences * buyAmountTinybar` (or the entire `msg.value`
     *      when `maxCadences = 0`). The tinybar remainder that cannot fund a full cadence
     *      is left as keeper reward.
     * @param _tokenOut HTS token to buy (must have a WHBAR pair on SaucerSwap V1).
     * @param _buyAmountTinybar HBAR to swap per cadence, in tinybars.
     * @param _cadenceSeconds Seconds between two consecutive swaps (>= MIN_CADENCE_SECONDS).
     * @param _maxSlippageBps Maximum accepted slippage in basis points (<= MAX_SLIPPAGE_BPS).
     * @param _maxCadences Maximum number of cadences (0 = funded until the escrow runs dry).
     */
    function createStream(
        address _tokenOut,
        uint256 _buyAmountTinybar,
        uint256 _cadenceSeconds,
        uint256 _maxSlippageBps,
        uint256 _maxCadences
    ) external payable returns (uint256 streamId) {
        if (_tokenOut == address(0) || _tokenOut == whbar) revert InvalidToken();
        if (_buyAmountTinybar == 0) revert ZeroBuyAmount();
        if (_cadenceSeconds < MIN_CADENCE_SECONDS) revert CadenceTooShort();
        if (_maxSlippageBps == 0 || _maxSlippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh();

        streamId = ++streamCount;

        // The contract receives the purchased tokens, so associate it with the
        // output HTS token before the first swap (swap 'to' = address(this) must
        // be associated or the router reverts with TOKEN_NOT_ASSOCIATED_TO_ACCOUNT).
        int64 responseCode = IHederaTokenServiceMinimal(HTS_PRECOMPILE_ADDRESS).associateToken(address(this), _tokenOut);
        if (responseCode != HAPI_OK && responseCode != HAPI_ALREADY_ASSOCIATED) {
            revert TokenAssociationFailed(_tokenOut, responseCode);
        }

        uint256 fundedTinybar;
        if (_maxCadences > 0) {
            uint256 required = _maxCadences * _buyAmountTinybar;
            if (msg.value < required) revert InsufficientFunds(streamId, msg.value, required);
            fundedTinybar = required;
            if (msg.value > required) {
                payable(msg.sender).transfer(msg.value - required);
            }
        } else {
            if (msg.value < _buyAmountTinybar) revert InsufficientFunds(streamId, msg.value, _buyAmountTinybar);
            fundedTinybar = msg.value;
        }

        streams[streamId] = Stream({
            owner: msg.sender,
            tokenOut: _tokenOut,
            buyAmountTinybar: _buyAmountTinybar,
            cadenceSeconds: _cadenceSeconds,
            maxSlippageBps: _maxSlippageBps,
            maxCadences: _maxCadences,
            executedCadences: 0,
            lastExecutionAt: 0,
            nextExecutionAt: block.timestamp + _cadenceSeconds,
            fundedTinybar: fundedTinybar,
            isPaused: false
        });

        emit StreamCreated(streamId, msg.sender, _tokenOut, _buyAmountTinybar, _cadenceSeconds, _maxSlippageBps, _maxCadences);
    }

    /**
     * @notice Pause a stream (keeper can no longer execute it). Owner only.
     */
    function pauseStream(uint256 _streamId) external {
        Stream storage s = _loadStream(_streamId);
        if (s.owner != msg.sender) revert NotStreamOwner(_streamId, msg.sender);
        s.isPaused = true;
        emit StreamPaused(_streamId);
    }

    /**
     * @notice Resume a paused stream. Re-anchors `nextExecutionAt` so cadence stays honest.
     */
    function resumeStream(uint256 _streamId) external {
        Stream storage s = _loadStream(_streamId);
        if (s.owner != msg.sender) revert NotStreamOwner(_streamId, msg.sender);
        s.isPaused = false;
        s.lastExecutionAt = block.timestamp;
        s.nextExecutionAt = block.timestamp + s.cadenceSeconds;
        emit StreamResumed(_streamId);
    }

    /**
     * @notice Top up the HBAR escrow of an existing stream. Owner only.
     * @dev Extra funds beyond whole cadences are treated as net-new escrow; the owner
     *      can recover them via {closeStream} or later cadences.
     */
    function topUpStream(uint256 _streamId) external payable {
        Stream storage s = _loadStream(_streamId);
        if (s.owner != msg.sender) revert NotStreamOwner(_streamId, msg.sender);
        s.fundedTinybar += msg.value;
    }

    /**
     * @notice Execute the next due cadence of a stream.
     * @dev Permissionless: any keeper may call this once `nextExecutionAt` is reached.
     *      Quotes `getAmountsOut` on the live AMM, applies slippage, swaps via the
     *      SaucerSwap router, accrues tokens, and schedules the next cadence.
     * @return amountOut Token units received by this contract.
     */
    function executeById(uint256 _streamId) external returns (uint256 amountOut) {
        Stream storage s = _loadStream(_streamId);
        if (s.isPaused) revert StreamIsPaused(_streamId);
        if (block.timestamp < s.nextExecutionAt) revert StreamNotDue(_streamId, s.nextExecutionAt);
        if (s.fundedTinybar < s.buyAmountTinybar) revert InsufficientFunds(_streamId, s.fundedTinybar, s.buyAmountTinybar);

        address[] memory path = new address[](2);
        path[0] = whbar;
        path[1] = s.tokenOut;

        uint256[] memory quote = ISaucerSwapV1Router(router).getAmountsOut(s.buyAmountTinybar, path);
        uint256 amountOutMin = (quote[quote.length - 1] * (BPS - s.maxSlippageBps)) / BPS;
        if (amountOutMin == 0) revert SwapFailed("zero quote");

        uint256 deadline = block.timestamp + MAX_DEADLINE_LOOKAHEAD_SECONDS;

        try ISaucerSwapV1Router(router).swapExactETHForTokens{ value: s.buyAmountTinybar }(
            amountOutMin,
            path,
            address(this),
            deadline
        ) returns (uint256[] memory amounts) {
            amountOut = amounts[amounts.length - 1];
        } catch (bytes memory reason) {
            revert SwapFailed(reason);
        }

        s.fundedTinybar -= s.buyAmountTinybar;
        s.executedCadences += 1;
        s.lastExecutionAt = block.timestamp;
        s.nextExecutionAt = block.timestamp + s.cadenceSeconds;

        if (s.maxCadences > 0 && s.executedCadences >= s.maxCadences) {
            s.fundedTinybar = 0;
        }

        _accrued[_streamId][s.tokenOut] += amountOut;

        emit CadenceExecuted(_streamId, s.executedCadences, s.buyAmountTinybar, amountOut, s.tokenOut);
    }

    /**
     * @notice Amount of `tokenOut` a stream owner can currently withdraw.
     */
    function accruedOf(uint256 _streamId, address _tokenOut) external view returns (uint256) {
        return _accrued[_streamId][_tokenOut];
    }

    /**
     * @notice Withdraw accrued purchased tokens. Owner only.
     */
    function withdraw(uint256 _streamId, address _tokenOut) external {
        Stream storage s = _loadStream(_streamId);
        if (s.owner != msg.sender) revert NotStreamOwner(_streamId, msg.sender);

        uint256 amount = _accrued[_streamId][_tokenOut];
        if (amount == 0) revert NothingToWithdraw(_streamId, _tokenOut);

        _accrued[_streamId][_tokenOut] = 0;
        bool ok = IERC20Minimal(_tokenOut).transfer(msg.sender, amount);
        if (!ok) revert TokenTransferFailed();

        emit TokensWithdrawn(_streamId, msg.sender, _tokenOut, amount);
    }

    /**
     * @notice Close a stream and refund the remaining HBAR escrow to the owner.
     */
    function closeStream(uint256 _streamId) external {
        Stream storage s = _loadStream(_streamId);
        if (s.owner != msg.sender) revert NotStreamOwner(_streamId, msg.sender);

        uint256 refund = s.fundedTinybar;
        s.fundedTinybar = 0;

        if (refund > 0) {
            payable(s.owner).transfer(refund);
        }

        emit StreamClosed(_streamId, refund);
    }

    /**
     * @notice Read a stream struct.
     */
    function getStream(uint256 _streamId) external view returns (Stream memory) {
        _loadStream(_streamId);
        return streams[_streamId];
    }

    /// @dev Reusable load with existence check.
    function _loadStream(uint256 _streamId) private view returns (Stream storage s) {
        s = streams[_streamId];
        if (s.owner == address(0)) revert StreamNotFound(_streamId);
    }
}