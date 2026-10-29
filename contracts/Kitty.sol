// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ─── Kitty ──────────────────────────────────────────────────────────────────
// "Put money in the kitty." Nobody fronts the money.
//
// A pot escrows an ERC-20 until its goal is met. Two modes:
//
//   Split (0)  The creator names up to 64 contributors with fixed shares that
//              sum exactly to the goal. Only named contributors may fund, each
//              up to their own share.
//   Open  (1)  All-or-nothing crowdfunding. Anyone may fund any amount above
//              zero (optionally above a per-pot minimum) until the goal is
//              reached. Up to 256 distinct contributors.
//
// Both modes: funding closes at the deadline. Once totalFunded == goal anyone
// may call settle(), which pays the full goal to the recipient exactly once.
// If the deadline passes with the pot not fully funded, every contributor may
// call refund() to pull exactly their own contribution, once.
//
// RULE 1, stuck-funds safety valve (SETTLE_GRACE = 30 days):
//   - Before deadline + SETTLE_GRACE a fully funded pot is settle-only: settle()
//     works, refund() reverts PotFullyFunded.
//   - From block.timestamp >= deadline + SETTLE_GRACE a fully funded pot that is
//     still unsettled can no longer be settled (settle() reverts
//     SettleWindowClosed) and every contributor may refund() their own
//     contribution once. Settle and refund are therefore mutually exclusive:
//     a pot can never be partly refunded and then settled. This recovers funds
//     when the recipient cannot receive the token (for example it is blocklisted).
//   - Incomplete pots are refundable from the deadline, as before.
//
// RULE 2, dust floor for Open pots:
//   effectiveMin = max(minContribution, ceil(goal / MAX_OPEN_CONTRIBUTORS)).
//   A FIRST-time funder must contribute at least effectiveMin, unless the
//   contribution exactly completes the goal (amount == goal - totalFunded).
//   Repeat funders (already listed) may add any amount above zero. Because
//   every listed funder paid at least the floor, occupying all 256 slots costs
//   at least the whole goal, which completes the pot. See effectiveMinContribution.
//   minContribution therefore applies to first-time contributions only.
//
// Payment request: a seller creates a pot with recipient == msg.sender. There is
// no special code path; the UI can label a pot "Requested by the seller" when
// creator == recipient. The creator has no powers after creation.
//
// Pot ids: potId = keccak256(abi.encode(creator, salt)). Ids cannot be chosen
// or squatted by anyone but the creator. See computePotId.
//
// Token: one immutable ERC-20 per deployment, set in the constructor.
// Production target: Arc USDC 0x3600000000000000000000000000000000000000
// (6 decimals).
//
// Trust and assumptions:
// - The token must be a standard ERC-20 (no fee-on-transfer; a short receipt
//   reverts fund()). USDC is the intended token.
// - A token-level blacklist or freeze of the recipient (settle) or of a
//   contributor (refund) can trap that pot's funds. A freeze of THIS CONTRACT's
//   address by the token issuer would block settle and refund for EVERY pot.
//   A fully funded pot whose recipient cannot receive the token becomes
//   refundable once the SETTLE_GRACE window opens (RULE 1). There is no admin
//   escape hatch or emergency exit; a freeze of this contract itself cannot be
//   worked around by any contract logic.
// - Deadlines use block.timestamp.
// - Open pots: the dust floor (RULE 2) makes filling every contributor slot
//   cost at least the goal. The floor is waived only for the contribution that
//   exactly completes the goal, so a pot can never become impossible to fill.
// - Settlement does not guarantee off-chain delivery.
// ─────────────────────────────────────────────────────────────────────────────

contract Kitty is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Types ─────────────────────────────────────────────────────────────────

    enum Mode { Split, Open }

    struct Pot {
        // Immutable terms, set once at creation.
        address creator;
        address recipient;
        uint64  deadline;
        Mode    mode;
        bool    settled;
        uint256 goal;
        uint256 minContribution; // Open pots only; 0 = none
        string  ref;

        // State
        uint256 totalFunded;
        address[] contributors;
        mapping(address => uint256) share;        // Split pots: agreed allocation
        mapping(address => uint256) contributed;
        mapping(address => bool)    refunded;
    }

    // ── Immutable token and constants ─────────────────────────────────────────

    /// The single ERC-20 accepted by every pot on this deployment.
    IERC20 public immutable token;

    uint256 public constant MAX_SPLIT_CONTRIBUTORS = 64;
    uint256 public constant MAX_OPEN_CONTRIBUTORS  = 256;
    uint256 public constant MAX_REF_BYTES          = 64;

    /// A fully funded pot still unsettled this long after its deadline is refundable
    /// and can no longer be settled.
    uint256 public constant SETTLE_GRACE           = 30 days;

    // ── Storage ───────────────────────────────────────────────────────────────

    mapping(bytes32 => Pot) private _pots;

    /// Tokens this contract owes: sum of contributions in pots that are neither
    /// settled nor refunded. Stray transfers never count toward entitlements.
    uint256 public totalEscrowLiability;

    // ── Events ────────────────────────────────────────────────────────────────

    event PotCreated(
        bytes32 indexed potId,
        address indexed creator,
        address indexed recipient,
        Mode    mode,
        uint256 goal,
        uint64  deadline,
        string  ref
    );
    event Funded(bytes32 indexed potId, address indexed contributor, uint256 amount, uint256 totalFunded);
    event Settled(bytes32 indexed potId, address indexed recipient, uint256 amount);
    event Refunded(bytes32 indexed potId, address indexed contributor, uint256 amount);

    // ── Errors ────────────────────────────────────────────────────────────────

    error InvalidToken();
    error PotAlreadyExists(bytes32 potId);
    error PotNotFound(bytes32 potId);
    error InvalidRecipient();
    error ZeroGoal();
    error DeadlineNotFuture();
    error RefTooLong();
    error NoContributors();
    error TooManyContributors();
    error LengthMismatch(uint256 contributors, uint256 shares);
    error InvalidContributor();
    error ZeroShare();
    error DuplicateContributor(address contributor);
    error SharesSumMismatch(uint256 actual, uint256 expected);
    error InvalidMinContribution();
    error ZeroAmount();
    error DeadlinePassed();
    error NotAContributor();
    error ExceedsShare(uint256 attempted, uint256 share);
    error ExceedsGoal(uint256 amount, uint256 remaining);
    error BelowMinContribution(uint256 amount, uint256 minimum);
    error TokenTransferShort(uint256 expected, uint256 received);
    error AlreadySettled();
    error NotFullyFunded();
    error SettleWindowClosed();
    error DeadlineNotReached();
    error PotFullyFunded();
    error AlreadyRefunded();
    error NothingToRefund();

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @param token_ ERC-20 used by every pot (Arc USDC in production).
    constructor(address token_) {
        if (token_ == address(0) || token_.code.length == 0) revert InvalidToken();
        token = IERC20(token_);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /// @notice Derive the id a creator gets for a salt. Ids cannot be squatted:
    ///         the creator address is part of the preimage.
    function computePotId(address creator, bytes32 salt) external pure returns (bytes32) {
        return _potId(creator, salt);
    }

    /// @notice Create a Split pot: named contributors with fixed shares summing to `goal`.
    /// @param salt          Caller-chosen salt; the id is keccak256(abi.encode(msg.sender, salt)).
    /// @param recipient     Payee. Not zero, not this contract, not the token.
    /// @param goal          Total in token units.
    /// @param deadline      Unix time at which funding closes (must be in the future).
    /// @param ref           Title or invoice reference, at most 64 bytes.
    /// @param contributors  1..64 unique, non-zero addresses.
    /// @param shares        Non-zero share per contributor; must sum to `goal`.
    function createSplitPot(
        bytes32 salt,
        address recipient,
        uint256 goal,
        uint64  deadline,
        string calldata ref,
        address[] calldata contributors,
        uint256[] calldata shares
    ) external returns (bytes32 potId) {
        uint256 n = contributors.length;
        if (n == 0) revert NoContributors();
        if (n > MAX_SPLIT_CONTRIBUTORS) revert TooManyContributors();
        if (shares.length != n) revert LengthMismatch(n, shares.length);

        Pot storage p;
        (potId, p) = _create(salt, recipient, goal, deadline, ref, Mode.Split, 0);

        uint256 sum = 0;
        for (uint256 i = 0; i < n; ++i) {
            address c = contributors[i];
            uint256 s = shares[i];
            if (c == address(0)) revert InvalidContributor();
            if (s == 0) revert ZeroShare();
            if (p.share[c] != 0) revert DuplicateContributor(c);
            p.share[c] = s;
            p.contributors.push(c);
            sum += s;
        }
        if (sum != goal) revert SharesSumMismatch(sum, goal);
    }

    /// @notice Create an Open pot: anyone may fund any amount until the goal is met.
    /// @param minContribution Creator floor for FIRST-time funders (0 = none). The
    ///                        contract enforces max(minContribution, ceil(goal / 256));
    ///                        waived only for the contribution that exactly completes the goal.
    function createOpenPot(
        bytes32 salt,
        address recipient,
        uint256 goal,
        uint64  deadline,
        string calldata ref,
        uint256 minContribution
    ) external returns (bytes32 potId) {
        if (minContribution > goal) revert InvalidMinContribution();
        (potId, ) = _create(salt, recipient, goal, deadline, ref, Mode.Open, minContribution);
    }

    function _create(
        bytes32 salt,
        address recipient,
        uint256 goal,
        uint64  deadline,
        string calldata ref,
        Mode    mode,
        uint256 minContribution
    ) private returns (bytes32 potId, Pot storage p) {
        potId = _potId(msg.sender, salt);
        p = _pots[potId];
        if (p.creator != address(0)) revert PotAlreadyExists(potId);
        // A self- or token-address recipient would "settle" while tokens stay trapped.
        if (recipient == address(0) || recipient == address(this) || recipient == address(token)) {
            revert InvalidRecipient();
        }
        if (goal == 0) revert ZeroGoal();
        if (deadline <= block.timestamp) revert DeadlineNotFuture();
        if (bytes(ref).length > MAX_REF_BYTES) revert RefTooLong();

        p.creator = msg.sender;
        p.recipient = recipient;
        p.deadline = deadline;
        p.mode = mode;
        p.goal = goal;
        p.minContribution = minContribution;
        p.ref = ref;

        emit PotCreated(potId, msg.sender, recipient, mode, goal, deadline, ref);
    }

    // ── Fund ──────────────────────────────────────────────────────────────────

    /// @notice Put `amount` in the kitty. Caller must have approved this contract.
    ///         Rejects fee-on-transfer tokens by requiring an exact receipt.
    function fund(bytes32 potId, uint256 amount) external nonReentrant {
        Pot storage p = _pot(potId);
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp >= p.deadline) revert DeadlinePassed();
        // Written as a subtraction so a huge `amount` cannot overflow.
        uint256 remaining = p.goal - p.totalFunded;
        if (amount > remaining) revert ExceedsGoal(amount, remaining);

        uint256 newTotal = p.totalFunded + amount;
        uint256 prior = p.contributed[msg.sender];
        uint256 newContrib = prior + amount;

        if (p.mode == Mode.Split) {
            uint256 s = p.share[msg.sender];
            if (s == 0) revert NotAContributor();
            if (newContrib > s) revert ExceedsShare(newContrib, s);
        } else {
            if (prior == 0) {
                // First-time funder: dust floor, waived only for the completing payment.
                uint256 floorAmt = _effectiveMin(p);
                if (amount < floorAmt && amount != remaining) revert BelowMinContribution(amount, floorAmt);
                if (p.contributors.length >= MAX_OPEN_CONTRIBUTORS) revert TooManyContributors();
                p.contributors.push(msg.sender);
            }
        }

        // Effects before the external call.
        p.contributed[msg.sender] = newContrib;
        p.totalFunded = newTotal;
        totalEscrowLiability += amount;

        emit Funded(potId, msg.sender, amount, newTotal);

        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balAfter = token.balanceOf(address(this));
        uint256 received = balAfter > balBefore ? balAfter - balBefore : 0;
        if (received != amount) revert TokenTransferShort(amount, received);
    }

    // ── Settle ────────────────────────────────────────────────────────────────

    /// @notice Pay the full goal to the recipient. Permissionless once
    ///         totalFunded == goal; callable before or after the deadline but only
    ///         until deadline + SETTLE_GRACE; once only.
    function settle(bytes32 potId) external nonReentrant {
        Pot storage p = _pot(potId);
        if (p.settled) revert AlreadySettled();
        uint256 goal = p.goal;
        if (p.totalFunded != goal) revert NotFullyFunded();
        // Once the grace window opens the pot is refund-only (mutually exclusive with settle).
        if (block.timestamp >= uint256(p.deadline) + SETTLE_GRACE) revert SettleWindowClosed();

        p.settled = true;
        totalEscrowLiability -= goal;

        address recipient = p.recipient;
        emit Settled(potId, recipient, goal);

        token.safeTransfer(recipient, goal);
    }

    // ── Refund ────────────────────────────────────────────────────────────────

    /// @notice After the deadline, pull back exactly your own contribution from a
    ///         pot that is not fully funded, or from a fully funded pot that is
    ///         still unsettled at deadline + SETTLE_GRACE. Once per contributor.
    function refund(bytes32 potId) external nonReentrant {
        Pot storage p = _pot(potId);
        if (block.timestamp < p.deadline) revert DeadlineNotReached();
        if (p.settled) revert AlreadySettled();
        // A fully funded pot is settle-only until the grace window opens.
        if (p.totalFunded == p.goal && block.timestamp < uint256(p.deadline) + SETTLE_GRACE) {
            revert PotFullyFunded();
        }
        if (p.refunded[msg.sender]) revert AlreadyRefunded();
        uint256 amt = p.contributed[msg.sender];
        if (amt == 0) revert NothingToRefund();

        p.refunded[msg.sender] = true;
        totalEscrowLiability -= amt;

        emit Refunded(potId, msg.sender, amt);

        token.safeTransfer(msg.sender, amt);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getPot(bytes32 potId)
        external
        view
        returns (
            address creator,
            address recipient,
            uint256 goal,
            uint64  deadline,
            string memory ref,
            Mode    mode,
            bool    settled,
            uint256 totalFunded,
            uint256 minContribution,
            uint256 contributorCount
        )
    {
        Pot storage p = _pot(potId);
        return (
            p.creator,
            p.recipient,
            p.goal,
            p.deadline,
            p.ref,
            p.mode,
            p.settled,
            p.totalFunded,
            p.minContribution,
            p.contributors.length
        );
    }

    /// @notice Smallest contribution a FIRST-time funder may make to an Open pot:
    ///         max(minContribution, ceil(goal / MAX_OPEN_CONTRIBUTORS)). Waived only
    ///         for the exact completing payment. Repeat funders may add any amount
    ///         above zero. Returns 0 for Split pots (not applicable).
    function effectiveMinContribution(bytes32 potId) external view returns (uint256) {
        Pot storage p = _pot(potId);
        return p.mode == Mode.Open ? _effectiveMin(p) : 0;
    }

    function getContributors(bytes32 potId) external view returns (address[] memory) {
        return _pot(potId).contributors;
    }

    /// @return share        Agreed share (Split pots; 0 for Open pots).
    /// @return contributed  Amount funded so far.
    /// @return refunded     True once the contributor has pulled a refund.
    function getContribution(bytes32 potId, address who)
        external
        view
        returns (uint256 share, uint256 contributed, bool refunded)
    {
        Pot storage p = _pot(potId);
        return (p.share[who], p.contributed[who], p.refunded[who]);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _effectiveMin(Pot storage p) private view returns (uint256) {
        uint256 goal = p.goal;
        uint256 dust = goal / MAX_OPEN_CONTRIBUTORS + (goal % MAX_OPEN_CONTRIBUTORS == 0 ? 0 : 1);
        uint256 creatorMin = p.minContribution;
        return creatorMin > dust ? creatorMin : dust;
    }

    function _potId(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }

    function _pot(bytes32 potId) private view returns (Pot storage p) {
        p = _pots[potId];
        if (p.creator == address(0)) revert PotNotFound(potId);
    }
}
