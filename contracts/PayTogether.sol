// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─── PayTogether ────────────────────────────────────────────────────────────
// Shared checkout escrow: contributors fund their agreed shares of a fixed
// total; once exactly fully funded, anyone may call settle() to pay the
// fixed merchant once. After the deadline, if the order is incomplete,
// each contributor may call refund() to reclaim exactly their own
// contribution. No owner, no admin withdrawal, no upgrades.
//
// Token is fixed at deploy time (constructor arg). All orders on one
// deployment share the same ERC-20 token. Deploy a fresh instance for a
// different token. Production target: canonical Arc Testnet USDC ERC-20
// (0x3600000000000000000000000000000000000000, 6 decimals).
//
// Trust / assumption notes (see docs/verification-report.md):
// - Token must behave as a standard ERC-20: no fee-on-transfer, no arbitrary
//   callbacks on transfer, no admin freeze during a transaction.
// - Token freeze or restriction after a fund() call may trap contributed funds.
//   There is no admin withdrawal or emergency exit.
// - Merchant address is trusted by the organizer at order creation time.
// - No oracle: deadline uses block.timestamp.
// - Settlement does not guarantee off-chain delivery or postpayment refund.
// - There is no automatic execution; settle/refund require an explicit caller.
// - This contract does not support generic ERC-20 tokens; use only USDC.
// ─────────────────────────────────────────────────────────────────────────────

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PayTogether is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutable token ───────────────────────────────────────────────────────

    /// The single ERC-20 token accepted by all orders on this deployment.
    /// Fixed at construction; cannot be changed.
    IERC20 public immutable token;

    // ── Constants ─────────────────────────────────────────────────────────────

    /// Maximum number of contributors per order.
    uint256 public constant MAX_CONTRIBUTORS = 64;

    // ── Order data ────────────────────────────────────────────────────────────

    struct Order {
        // Immutable terms (set once at create, never editable)
        address merchant;
        uint256 target;          // total token amount (6-decimal units for USDC)
        uint256 deadline;        // block.timestamp deadline (exclusive for funding)
        string  ref;             // arbitrary order reference string

        // State
        bool    settled;
        uint256 totalFunded;     // sum of all contributions so far

        // Per-contributor allocation and contribution tracking
        mapping(address => uint256) share;        // agreed allocation per contributor
        mapping(address => uint256) contributed;  // amount actually funded so far
        mapping(address => bool)    refunded;     // true after refund claimed
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    /// All orders, keyed by a bytes32 orderId chosen by the organizer at create.
    mapping(bytes32 => Order) private _orders;

    /// Ordered list of contributors per order (for existence checks).
    mapping(bytes32 => address[]) private _contributors;

    /// Total token liability this contract owes (sum of all unfinalised contributions).
    /// Tracked separately so accidental token transfers cannot inflate entitlements.
    uint256 public totalEscrowLiability;

    // ── Events ────────────────────────────────────────────────────────────────

    event OrderCreated(
        bytes32 indexed orderId,
        address indexed merchant,
        uint256 target,
        uint256 deadline,
        string  ref
    );

    event Funded(
        bytes32 indexed orderId,
        address indexed contributor,
        uint256 amount,
        uint256 totalFunded
    );

    event Settled(
        bytes32 indexed orderId,
        address indexed merchant,
        uint256 amount
    );

    event Refunded(
        bytes32 indexed orderId,
        address indexed contributor,
        uint256 amount
    );

    // ── Errors ────────────────────────────────────────────────────────────────

    error OrderAlreadyExists();
    error InvalidMerchant();
    error ZeroTarget();
    error DeadlineNotFuture();
    error TooManyContributors();
    error DuplicateContributor();
    error ZeroShare();
    error SharesSumMismatch();
    error OrderNotFound();
    error NotAContributor();
    error ZeroAmount();
    error ExceedsShare();
    error ExceedsTarget();
    error DeadlinePassed();
    error NotFullyFunded();
    error AlreadySettled();
    error DeadlineNotReached();
    error AlreadyRefunded();
    error NothingToRefund();
    error OrderFullyFunded();
    error TokenTransferShort();

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @param token_ ERC-20 token for all orders (e.g. Arc Testnet USDC).
    constructor(address token_) {
        require(token_ != address(0), "PayTogether: zero token");
        token = IERC20(token_);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /// @notice Create a new shared-checkout order.
    /// @param orderId       Unique identifier chosen by the organizer.
    /// @param merchant      Address that will receive the full payment on settle.
    ///                      Must not be zero or this contract (self-transfer would
    ///                      mark the order settled while funds stay in escrow).
    /// @param target        Total amount in token's native units (6 decimals for USDC).
    /// @param deadline      Unix timestamp after which funding is closed.
    /// @param ref           Arbitrary order reference string (SKU, invoice, etc.).
    /// @param contributors  List of contributor addresses (unique, non-zero, ≤ 64).
    /// @param shares        Corresponding agreed share per contributor (sums == target).
    function createOrder(
        bytes32        orderId,
        address        merchant,
        uint256        target,
        uint256        deadline,
        string calldata ref,
        address[] calldata contributors,
        uint256[] calldata shares
    ) external {
        // ── Validate inputs ──────────────────────────────────────────────────
        if (_orders[orderId].target != 0) revert OrderAlreadyExists();
        // Reject zero address AND self-address: a self-transfer would call
        // token.safeTransfer(address(this), ...) marking the order settled
        // while the tokens remain trapped in this contract with no withdrawal path.
        if (merchant == address(0) || merchant == address(this)) revert InvalidMerchant();
        if (target == 0)                   revert ZeroTarget();
        // deadline must be strictly in the future
        if (deadline <= block.timestamp)   revert DeadlineNotFuture();
        uint256 n = contributors.length;
        if (n == 0 || n > MAX_CONTRIBUTORS) revert TooManyContributors();
        if (shares.length != n)             revert TooManyContributors(); // length mismatch

        // ── Validate contributors / shares ───────────────────────────────────
        Order storage o = _orders[orderId];
        uint256 sum = 0;
        for (uint256 i = 0; i < n; ) {
            address c = contributors[i];
            if (c == address(0))           revert InvalidMerchant(); // reuse: zero addr
            if (shares[i] == 0)            revert ZeroShare();
            if (o.share[c] != 0)           revert DuplicateContributor();
            o.share[c] = shares[i];
            sum += shares[i];
            _contributors[orderId].push(c);
            unchecked { ++i; }
        }
        if (sum != target) revert SharesSumMismatch();

        // ── Populate immutable order fields ──────────────────────────────────
        o.merchant = merchant;
        o.target   = target;
        o.deadline = deadline;
        o.ref      = ref;
        // settled = false, totalFunded = 0 by default

        emit OrderCreated(orderId, merchant, target, deadline, ref);
    }

    // ── Fund ──────────────────────────────────────────────────────────────────

    /// @notice Contribute towards your share of an order.
    /// @dev    Caller must have approved this contract for at least `amount`.
    ///         Rejects fee-on-transfer tokens: requires exact balance receipt.
    function fund(bytes32 orderId, uint256 amount) external nonReentrant {
        Order storage o = _orders[orderId];
        if (o.target == 0)                                 revert OrderNotFound();
        if (o.share[msg.sender] == 0)                     revert NotAContributor();
        if (amount == 0)                                   revert ZeroAmount();
        // Funding not allowed at or after deadline
        if (block.timestamp >= o.deadline)                revert DeadlinePassed();
        // Cumulative contribution must not exceed the contributor's own share
        uint256 newContrib = o.contributed[msg.sender] + amount;
        if (newContrib > o.share[msg.sender])             revert ExceedsShare();
        // Total funded must not exceed target
        uint256 newTotal = o.totalFunded + amount;
        if (newTotal > o.target)                          revert ExceedsTarget();

        // ── Effects before external call ─────────────────────────────────────
        o.contributed[msg.sender] = newContrib;
        o.totalFunded             = newTotal;
        totalEscrowLiability      += amount;

        // ── Transfer tokens in — revert on failure (SafeERC20) ───────────────
        // Check balance before and after to detect fee-on-transfer tokens.
        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balAfter = token.balanceOf(address(this));
        if (balAfter - balBefore != amount) {
            // Fee-on-transfer: undo effects and revert
            o.contributed[msg.sender] = newContrib - amount;
            o.totalFunded             = newTotal - amount;
            totalEscrowLiability      -= amount;
            revert TokenTransferShort();
        }

        emit Funded(orderId, msg.sender, amount, o.totalFunded);
    }

    // ── Settle ────────────────────────────────────────────────────────────────

    /// @notice Settle a fully-funded order: transfer the full amount to merchant.
    ///         Permissionless — anyone may call once totalFunded == target.
    ///         Callable both before and after deadline if fully funded.
    function settle(bytes32 orderId) external nonReentrant {
        Order storage o = _orders[orderId];
        if (o.target == 0)              revert OrderNotFound();
        if (o.settled)                  revert AlreadySettled();
        if (o.totalFunded < o.target)   revert NotFullyFunded();

        // ── Effects before external call ─────────────────────────────────────
        o.settled             = true;
        totalEscrowLiability -= o.target;

        // ── Transfer full amount to merchant ──────────────────────────────────
        token.safeTransfer(o.merchant, o.target);

        emit Settled(orderId, o.merchant, o.target);
    }

    // ── Refund ────────────────────────────────────────────────────────────────

    /// @notice Reclaim your contribution after deadline on an incomplete order.
    ///         Pull-based: caller must be the contributor; only their own funds.
    ///         Not available if the order was fully funded (settled or settleable).
    function refund(bytes32 orderId) external nonReentrant {
        Order storage o = _orders[orderId];
        if (o.target == 0)                              revert OrderNotFound();
        // Refund only available after deadline
        if (block.timestamp < o.deadline)               revert DeadlineNotReached();
        // Fully funded and settled orders are not refundable
        if (o.settled)                                  revert AlreadySettled();
        // Cannot refund a fully funded but unsettled order —
        // it remains settleable, not refundable.
        if (o.totalFunded == o.target)                  revert OrderFullyFunded();
        if (o.refunded[msg.sender])                     revert AlreadyRefunded();
        uint256 amt = o.contributed[msg.sender];
        if (amt == 0)                                   revert NothingToRefund();

        // ── Effects before external call ─────────────────────────────────────
        o.refunded[msg.sender] = true;
        totalEscrowLiability  -= amt;

        // ── Transfer contribution back to contributor ──────────────────────────
        token.safeTransfer(msg.sender, amt);

        emit Refunded(orderId, msg.sender, amt);
    }

    // ── Read helpers ──────────────────────────────────────────────────────────

    /// @notice Returns the immutable and mutable top-level fields of an order.
    /// @dev    token() is read from the immutable state variable, not per-order.
    function getOrder(bytes32 orderId)
        external view
        returns (
            address merchant,
            uint256 target,
            uint256 deadline,
            string  memory ref,
            bool    settled,
            uint256 totalFunded
        )
    {
        Order storage o = _orders[orderId];
        if (o.target == 0) revert OrderNotFound();
        return (
            o.merchant,
            o.target,
            o.deadline,
            o.ref,
            o.settled,
            o.totalFunded
        );
    }

    /// @notice Returns the contributor list for an order.
    function getContributors(bytes32 orderId)
        external view
        returns (address[] memory)
    {
        if (_orders[orderId].target == 0) revert OrderNotFound();
        return _contributors[orderId];
    }

    /// @notice Returns a contributor's share and current contribution for an order.
    function getContribution(bytes32 orderId, address contributor)
        external view
        returns (uint256 share, uint256 contributed, bool refunded)
    {
        Order storage o = _orders[orderId];
        if (o.target == 0) revert OrderNotFound();
        return (o.share[contributor], o.contributed[contributor], o.refunded[contributor]);
    }
}
