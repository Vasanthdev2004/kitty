// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../PayTogether.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ─── Mock ERC-20 helpers ──────────────────────────────────────────────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// Fee-on-transfer: deducts 1 unit so recipient gets value-1.
contract FeeToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function transferFrom(address from, address to, uint256 value)
        public override returns (bool)
    {
        _burn(from, 1);
        return super.transferFrom(from, to, value - 1);
    }
}

// Controllable revert on transferFrom (fund path) and transfer (settle/refund path).
contract RevertToken is ERC20 {
    bool public revertTransferFrom;
    bool public revertTransfer;
    constructor() ERC20("Revert Token", "REV") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setRevertTransferFrom(bool v) external { revertTransferFrom = v; }
    function setRevertTransfer(bool v) external { revertTransfer = v; }

    function transferFrom(address from, address to, uint256 value)
        public override returns (bool)
    {
        require(!revertTransferFrom, "RevertToken: transferFrom failed");
        return super.transferFrom(from, to, value);
    }

    function transfer(address to, uint256 value)
        public override returns (bool)
    {
        require(!revertTransfer, "RevertToken: transfer failed");
        return super.transfer(to, value);
    }
}

// Returns false from transferFrom (fund path) — always.
// Used to test the fund() incoming path rejection.
contract FalseReturnToken is ERC20 {
    bool public falseTransfer;
    constructor() ERC20("False Token", "FALSE") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setFalseTransfer(bool v) external { falseTransfer = v; }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false; // always false — SafeERC20 will revert on fund()
    }

    function transfer(address to, uint256 value)
        public override returns (bool)
    {
        if (falseTransfer) return false;
        return super.transfer(to, value);
    }
}

// Returns false from transfer() only (outgoing settle/refund path), but
// transferFrom() works normally (so fund() succeeds).
// Used to test outgoing false-return on settle AND refund independently.
contract FalseOutboundToken is ERC20 {
    bool public falseOutbound;
    constructor() ERC20("False Outbound", "FOUT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setFalseOutbound(bool v) external { falseOutbound = v; }

    // transferFrom (inbound fund path) works normally
    function transferFrom(address from, address to, uint256 value)
        public override returns (bool)
    {
        return super.transferFrom(from, to, value);
    }

    // transfer (outgoing settle/refund path) returns false when armed
    function transfer(address to, uint256 value)
        public override returns (bool)
    {
        if (falseOutbound) return false;
        return super.transfer(to, value);
    }
}

// ─── Reentrancy helpers ───────────────────────────────────────────────────────

// Attacker contract: funds via a mock USDC, then attempts nested calls
// when tokens are returned to it.
contract ReentrancyAttacker {
    PayTogether public immutable pt;
    bytes32     public targetOrder;

    bool public nestedRefundAttempted;
    bool public nestedRefundReverted;
    bytes  public nestedRefundRevertData;

    bool public nestedFundAttempted;
    bool public nestedFundReverted;
    bytes  public nestedFundRevertData;

    bool public nestedSettleAttempted;
    bool public nestedSettleReverted;
    bytes  public nestedSettleRevertData;

    enum AttackMode { Refund, Fund, Settle }
    AttackMode public mode;

    bytes32 public fundOrderId;
    uint256 public fundAmount;

    constructor(PayTogether _pt) { pt = _pt; }

    function setOrder(bytes32 id) external { targetOrder = id; }
    function setMode(AttackMode m) external { mode = m; }
    function setFundParams(bytes32 id, uint256 amt) external { fundOrderId = id; fundAmount = amt; }

    /// Called by the token's transfer() hook mid-refund/settle.
    /// Records raw revert data so tests can assert the exact error selector.
    function onTokenCallback() external {
        if (mode == AttackMode.Refund) {
            nestedRefundAttempted = true;
            try pt.refund(targetOrder) {
                nestedRefundReverted = false;
            } catch (bytes memory data) {
                nestedRefundReverted = true;
                nestedRefundRevertData = data;
            }
        } else if (mode == AttackMode.Fund) {
            nestedFundAttempted = true;
            try pt.fund(fundOrderId, fundAmount) {
                nestedFundReverted = false;
            } catch (bytes memory data) {
                nestedFundReverted = true;
                nestedFundRevertData = data;
            }
        } else if (mode == AttackMode.Settle) {
            nestedSettleAttempted = true;
            try pt.settle(targetOrder) {
                nestedSettleReverted = false;
            } catch (bytes memory data) {
                nestedSettleReverted = true;
                nestedSettleRevertData = data;
            }
        }
    }

    receive() external payable {}
}

// Token that calls attacker.onTokenCallback() on outgoing transfer().
// Does NOT affect transferFrom (inbound fund path).
contract CallbackToken is ERC20 {
    ReentrancyAttacker public attacker;
    bool               public armed;
    constructor() ERC20("Callback Token", "CB") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setAttacker(ReentrancyAttacker a) external { attacker = a; }
    function arm() external { armed = true; }
    function disarm() external { armed = false; }

    function transfer(address to, uint256 value) public override returns (bool) {
        bool ok = super.transfer(to, value);
        // Fire callback AFTER tokens move (simulates ERC-777 / malicious hook).
        // Disarm first to prevent infinite loop (attacker may call pt functions
        // that do NOT re-enter this token, so the callback itself is one-shot).
        if (armed && address(attacker) != address(0)) {
            armed = false;
            attacker.onTokenCallback();
        }
        return ok;
    }
}

// ─── Stateful invariant test ──────────────────────────────────────────────────
//
// Three independent orders with different share structures allow fund, settle,
// and refund handlers to execute on different orders concurrently, preventing
// the early-warp-makes-everything-a-no-op problem of a single-order design.
//
// Shadow ledger tracks funded/refunded/merchantPaid per order per actor so
// invariants can compare against contract state.
//
// A deterministic coverage test (test_invariantCoverage_fundSettleRefundAllExecute)
// proves each operation path executes at least once — it runs outside the
// invariant suite.

contract PayTogetherInvariantTest is Test {
    PayTogether  public pt;
    MockUSDC     public usdc;

    address[]    public actors;

    // Three orders with different structures
    bytes32[] public orders;
    uint256[] public targets;
    uint256   public deadline0;  // order[0]: expires early (funds before deadline)
    uint256   public deadline1;  // order[1]: expires later (for settle path)
    uint256   public deadline2;  // order[2]: expires mid (for refund path)

    // Shadow ledger: order index → actor → amount
    mapping(uint256 => mapping(address => uint256)) public shadowFunded;
    mapping(uint256 => mapping(address => uint256)) public shadowRefunded;
    mapping(uint256 => uint256)                     public shadowMerchantPaid;
    mapping(uint256 => bool)                        public shadowSettled;

    // Coverage counters
    uint256 public fundCount;
    uint256 public settleCount;
    uint256 public refundCount;

    address immutable MERCHANT = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        pt   = new PayTogether(address(usdc));

        // 5 actors
        for (uint256 i = 1; i <= 5; i++) {
            actors.push(address(uint160(0x100 + i)));
            usdc.mint(actors[i - 1], 10_000_000e6);
        }
        for (uint256 i = 0; i < actors.length; i++) {
            vm.prank(actors[i]);
            usdc.approve(address(pt), type(uint256).max);
        }

        // Order 0: 3 actors, 60/25/15 shares, expires in 1 day (settle/refund early)
        deadline0 = block.timestamp + 1 days;
        {
            bytes32 id = keccak256("inv-order-0");
            orders.push(id);
            targets.push(100e6);
            address[] memory cs = new address[](3);
            uint256[] memory ss = new uint256[](3);
            cs[0] = actors[0]; ss[0] = 60e6;
            cs[1] = actors[1]; ss[1] = 25e6;
            cs[2] = actors[2]; ss[2] = 15e6;
            pt.createOrder(id, MERCHANT, 100e6, deadline0, "inv0", cs, ss);
        }

        // Order 1: 5 actors equal shares, expires in 5 days
        deadline1 = block.timestamp + 5 days;
        {
            bytes32 id = keccak256("inv-order-1");
            orders.push(id);
            targets.push(100e6);
            address[] memory cs = new address[](5);
            uint256[] memory ss = new uint256[](5);
            for (uint256 i = 0; i < 5; i++) { cs[i] = actors[i]; ss[i] = 20e6; }
            pt.createOrder(id, MERCHANT, 100e6, deadline1, "inv1", cs, ss);
        }

        // Order 2: 2 actors 50/50 shares, expires in 3 days
        deadline2 = block.timestamp + 3 days;
        {
            bytes32 id = keccak256("inv-order-2");
            orders.push(id);
            targets.push(100e6);
            address[] memory cs = new address[](2);
            uint256[] memory ss = new uint256[](2);
            cs[0] = actors[0]; ss[0] = 50e6;
            cs[1] = actors[1]; ss[1] = 50e6;
            pt.createOrder(id, MERCHANT, 100e6, deadline2, "inv2", cs, ss);
        }

        targetContract(address(this));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _deadline(uint256 ordIdx) internal view returns (uint256) {
        if (ordIdx == 0) return deadline0;
        if (ordIdx == 1) return deadline1;
        return deadline2;
    }

    function _actorIsContributor(uint256 ordIdx, address actor) internal view returns (bool) {
        address[] memory cs = pt.getContributors(orders[ordIdx]);
        for (uint256 i = 0; i < cs.length; i++) {
            if (cs[i] == actor) return true;
        }
        return false;
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    /// Fund: pick a random order + actor, fund 1..remaining_share.
    function handler_fund(uint256 ordSeed, uint256 actorSeed, uint256 amtSeed) public {
        uint256 ordIdx = ordSeed % orders.length;
        bytes32 ordId  = orders[ordIdx];
        address actor  = actors[actorSeed % actors.length];
        if (!_actorIsContributor(ordIdx, actor)) return;
        if (block.timestamp >= _deadline(ordIdx)) return;
        (uint256 share, uint256 contrib,) = pt.getContribution(ordId, actor);
        uint256 remaining = share - contrib;
        if (remaining == 0) return;
        (,,,,bool s,) = pt.getOrder(ordId);
        if (s) return;
        uint256 amt = bound(amtSeed, 1, remaining);
        vm.prank(actor);
        pt.fund(ordId, amt);
        shadowFunded[ordIdx][actor] += amt;
        fundCount++;
    }

    /// Settle: try to settle any fully-funded unsettled order.
    function handler_settle(uint256 ordSeed) public {
        uint256 ordIdx = ordSeed % orders.length;
        bytes32 ordId  = orders[ordIdx];
        (,,,,bool s, uint256 tf) = pt.getOrder(ordId);
        if (s || tf < targets[ordIdx]) return;
        uint256 mBefore = usdc.balanceOf(MERCHANT);
        pt.settle(ordId);
        shadowMerchantPaid[ordIdx] += usdc.balanceOf(MERCHANT) - mBefore;
        shadowSettled[ordIdx] = true;
        settleCount++;
    }

    /// Refund: expire order and attempt to refund a random contributor.
    function handler_refundAfterExpiry(uint256 ordSeed, uint256 actorSeed) public {
        uint256 ordIdx = ordSeed % orders.length;
        bytes32 ordId  = orders[ordIdx];
        uint256 dl     = _deadline(ordIdx);
        if (block.timestamp < dl) vm.warp(dl + 1);
        address actor  = actors[actorSeed % actors.length];
        if (!_actorIsContributor(ordIdx, actor)) return;
        (,uint256 contrib, bool ref) = pt.getContribution(ordId, actor);
        (,,,,bool s, uint256 tf) = pt.getOrder(ordId);
        if (s || tf >= targets[ordIdx] || ref || contrib == 0) return;
        uint256 before = usdc.balanceOf(actor);
        vm.prank(actor);
        pt.refund(ordId);
        shadowRefunded[ordIdx][actor] += usdc.balanceOf(actor) - before;
        refundCount++;
    }

    /// Token donation — must not inflate entitlements.
    function handler_donate(uint256 amt) public {
        amt = bound(amt, 1, 1000e6);
        usdc.mint(address(pt), amt);
    }

    /// Time advance.
    function handler_warp(uint256 delta) public {
        delta = bound(delta, 1, 2 days);
        vm.warp(block.timestamp + delta);
    }

    // ── Invariants ────────────────────────────────────────────────────────────

    /// Invariant A: totalEscrowLiability == sum of unrefunded contributions across all orders.
    function invariant_escrowLiabilityConsistent() public view {
        uint256 expected = 0;
        for (uint256 oi = 0; oi < orders.length; oi++) {
            (,,,,bool s,) = pt.getOrder(orders[oi]);
            if (s) continue; // settled orders don't contribute liability
            address[] memory cs = pt.getContributors(orders[oi]);
            for (uint256 ai = 0; ai < cs.length; ai++) {
                (,uint256 contrib, bool ref) = pt.getContribution(orders[oi], cs[ai]);
                if (!ref) expected += contrib;
            }
        }
        assertEq(pt.totalEscrowLiability(), expected, "liability != unrefunded sum");
    }

    /// Invariant B: contract token balance >= totalEscrowLiability.
    function invariant_balanceCoverLiability() public view {
        assertGe(
            usdc.balanceOf(address(pt)),
            pt.totalEscrowLiability(),
            "balance < liability"
        );
    }

    /// Invariant C: shadow refunded[ordIdx][actor] <= shadow funded[ordIdx][actor].
    function invariant_noDoubleSpend() public view {
        for (uint256 oi = 0; oi < orders.length; oi++) {
            for (uint256 ai = 0; ai < actors.length; ai++) {
                assertLe(
                    shadowRefunded[oi][actors[ai]],
                    shadowFunded[oi][actors[ai]],
                    "refunded > funded"
                );
            }
        }
    }

    /// Invariant D: each contributor's on-chain contributed <= their share.
    function invariant_contribLEShare() public view {
        for (uint256 oi = 0; oi < orders.length; oi++) {
            address[] memory cs = pt.getContributors(orders[oi]);
            for (uint256 ai = 0; ai < cs.length; ai++) {
                (uint256 share, uint256 contrib,) = pt.getContribution(orders[oi], cs[ai]);
                assertLe(contrib, share, "contrib > share");
            }
        }
    }

    /// Invariant E: totalFunded <= target for each order.
    function invariant_totalFundedLETarget() public view {
        for (uint256 oi = 0; oi < orders.length; oi++) {
            (,,,,, uint256 tf) = pt.getOrder(orders[oi]);
            assertLe(tf, targets[oi], "totalFunded > target");
        }
    }
}

// ─── Deterministic coverage test ─────────────────────────────────────────────
// Separate from the invariant suite. Proves fund, settle, and refund each
// execute successfully at least once, against the same 3-order setup.

contract PayTogetherCoverageTest is Test {
    PayTogether pt;
    MockUSDC    usdc;
    address MERCHANT = address(0xBEEF);
    address alice    = address(0x101);
    address bob      = address(0x102);
    address carol    = address(0x103);
    uint256 deadline;

    function setUp() public {
        usdc = new MockUSDC();
        pt   = new PayTogether(address(usdc));
        deadline = block.timestamp + 1 days;

        usdc.mint(alice, 10_000_000e6);
        usdc.mint(bob,   10_000_000e6);
        usdc.mint(carol, 10_000_000e6);
        vm.prank(alice); usdc.approve(address(pt), type(uint256).max);
        vm.prank(bob);   usdc.approve(address(pt), type(uint256).max);
        vm.prank(carol); usdc.approve(address(pt), type(uint256).max);
    }

    /// Proves fund, settle, and refund each execute at least once.
    function test_coverage_fundSettleRefund() public {
        bytes32 settleId = keccak256("cov-settle");
        bytes32 refundId = keccak256("cov-refund");

        // Order A: alice + bob, fully funds → settle
        {
            address[] memory cs = new address[](2);
            uint256[] memory ss = new uint256[](2);
            cs[0] = alice; ss[0] = 60e6;
            cs[1] = bob;   ss[1] = 40e6;
            pt.createOrder(settleId, MERCHANT, 100e6, deadline, "settle", cs, ss);
        }
        // Order B: alice + carol, alice funds, carol doesn't → refund after deadline
        {
            address[] memory cs = new address[](2);
            uint256[] memory ss = new uint256[](2);
            cs[0] = alice; ss[0] = 50e6;
            cs[1] = carol; ss[1] = 50e6;
            pt.createOrder(refundId, MERCHANT, 100e6, deadline, "refund", cs, ss);
        }

        // fund() executes — both alice and bob fund
        vm.prank(alice); pt.fund(settleId, 60e6);
        vm.prank(bob);   pt.fund(settleId, 40e6);
        // alice also funds the refund order
        vm.prank(alice); pt.fund(refundId, 50e6);

        // settle() executes — settleId is fully funded
        uint256 mBefore = usdc.balanceOf(MERCHANT);
        pt.settle(settleId);
        assertEq(usdc.balanceOf(MERCHANT) - mBefore, 100e6, "settle: merchant didn't receive target");
        (,,,,bool s,) = pt.getOrder(settleId);
        assertTrue(s, "settle: order not marked settled");

        // refund() executes — expire refundId then alice reclaims
        vm.warp(deadline + 1);
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice); pt.refund(refundId);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 50e6, "refund: alice didn't receive back contribution");
        (,,bool refunded) = pt.getContribution(refundId, alice);
        assertTrue(refunded, "refund: contribution not marked refunded");
    }
}

// ─── Main unit test suite ─────────────────────────────────────────────────────

contract PayTogetherTest is Test {
    PayTogether public pt;
    MockUSDC    public usdc;

    address organizer  = address(0x1);
    address alice      = address(0x2);
    address bob        = address(0x3);
    address carol      = address(0x4);
    address merchant   = address(0x5);
    address stranger   = address(0x6);

    bytes32 constant ORDER_A = keccak256("order-a");
    bytes32 constant ORDER_B = keccak256("order-b");

    uint256 deadline;

    function setUp() public {
        usdc     = new MockUSDC();
        pt       = new PayTogether(address(usdc));
        deadline = block.timestamp + 1 days;

        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob,   1_000_000e6);
        usdc.mint(carol, 1_000_000e6);

        vm.prank(alice); usdc.approve(address(pt), type(uint256).max);
        vm.prank(bob);   usdc.approve(address(pt), type(uint256).max);
        vm.prank(carol); usdc.approve(address(pt), type(uint256).max);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _createOrder100(bytes32 id) internal {
        address[] memory cs = new address[](3);
        uint256[] memory ss = new uint256[](3);
        cs[0] = alice;  ss[0] = 60e6;
        cs[1] = bob;    ss[1] = 25e6;
        cs[2] = carol;  ss[2] = 15e6;
        vm.prank(organizer);
        pt.createOrder(id, merchant, 100e6, deadline, "inv-001", cs, ss);
    }

    function _fullFund(bytes32 id) internal {
        vm.prank(alice); pt.fund(id, 60e6);
        vm.prank(bob);   pt.fund(id, 25e6);
        vm.prank(carol); pt.fund(id, 15e6);
    }

    // Helper: deploy a PayTogether backed by a custom token and create a single-contributor order.
    function _setupSingleActorOrder(
        ERC20 tok,
        bytes32 orderId,
        address actor,
        uint256 shareAmt
    ) internal returns (PayTogether newPt) {
        newPt = new PayTogether(address(tok));
        address[] memory cs = new address[](1);
        uint256[] memory ss = new uint256[](1);
        cs[0] = actor; ss[0] = shareAmt;
        vm.prank(organizer);
        newPt.createOrder(orderId, merchant, shareAmt, deadline, "test", cs, ss);
    }

    // ── Contract meta ─────────────────────────────────────────────────────────

    function test_token_isImmutable() public view {
        assertEq(address(pt.token()), address(usdc));
    }

    function test_constructor_rejectsZeroToken() public {
        vm.expectRevert();
        new PayTogether(address(0));
    }

    // ── Order creation ────────────────────────────────────────────────────────

    function test_createOrder_basic() public {
        _createOrder100(ORDER_A);
        (address m, uint256 tgt, uint256 dl, string memory ref,
         bool settled, uint256 funded) = pt.getOrder(ORDER_A);
        assertEq(m,       merchant);
        assertEq(tgt,     100e6);
        assertEq(dl,      deadline);
        assertEq(ref,     "inv-001");
        assertFalse(settled);
        assertEq(funded,  0);
        address[] memory cs = pt.getContributors(ORDER_A);
        assertEq(cs.length, 3);
    }

    function test_createOrder_rejectsZeroMerchant() public {
        address[] memory cs = new address[](1); uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = 10e6;
        vm.expectRevert(PayTogether.InvalidMerchant.selector);
        pt.createOrder(ORDER_A, address(0), 10e6, deadline, "", cs, ss);
    }

    function test_createOrder_rejectsMerchantSelf() public {
        // merchant == address(pt): would trap funds — must revert
        address[] memory cs = new address[](1); uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = 10e6;
        vm.expectRevert(PayTogether.InvalidMerchant.selector);
        pt.createOrder(ORDER_A, address(pt), 10e6, deadline, "", cs, ss);
    }

    function test_createOrder_rejectsZeroTarget() public {
        address[] memory cs = new address[](1); uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = 0;
        vm.expectRevert(PayTogether.ZeroTarget.selector);
        pt.createOrder(ORDER_A, merchant, 0, deadline, "", cs, ss);
    }

    function test_createOrder_rejectsNonFutureDeadline() public {
        address[] memory cs = new address[](1); uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = 10e6;
        vm.expectRevert(PayTogether.DeadlineNotFuture.selector);
        pt.createOrder(ORDER_A, merchant, 10e6, block.timestamp, "", cs, ss);
    }

    function test_createOrder_rejectsDuplicateContributor() public {
        address[] memory cs = new address[](2); uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = 50e6;
        cs[1] = alice; ss[1] = 50e6;
        vm.expectRevert(PayTogether.DuplicateContributor.selector);
        pt.createOrder(ORDER_A, merchant, 100e6, deadline, "", cs, ss);
    }

    function test_createOrder_rejectsSharesSumMismatch() public {
        address[] memory cs = new address[](2); uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = 60e6;
        cs[1] = bob;   ss[1] = 30e6; // 90 != 100
        vm.expectRevert(PayTogether.SharesSumMismatch.selector);
        pt.createOrder(ORDER_A, merchant, 100e6, deadline, "", cs, ss);
    }

    function test_createOrder_rejectsDuplicateOrderId() public {
        _createOrder100(ORDER_A);
        vm.expectRevert(PayTogether.OrderAlreadyExists.selector);
        _createOrder100(ORDER_A);
    }

    function test_createOrder_rejectsTooManyContributors() public {
        uint256 n = 65;
        address[] memory cs = new address[](n);
        uint256[] memory ss = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            cs[i] = address(uint160(0x100 + i));
            ss[i] = 100e6 / n;
        }
        vm.expectRevert(PayTogether.TooManyContributors.selector);
        pt.createOrder(ORDER_A, merchant, 100e6, deadline, "", cs, ss);
    }

    // ── Immutable terms ───────────────────────────────────────────────────────

    function test_terms_immutable_noEditFunction() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 30e6);
        (address m, uint256 tgt, uint256 dl,,,) = pt.getOrder(ORDER_A);
        assertEq(m,   merchant);
        assertEq(tgt, 100e6);
        assertEq(dl,  deadline);
    }

    // ── Funding ───────────────────────────────────────────────────────────────

    function test_fund_partialThenFull() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 30e6);
        (,uint256 contrib,) = pt.getContribution(ORDER_A, alice);
        assertEq(contrib, 30e6);
        (,,,,, uint256 funded) = pt.getOrder(ORDER_A);
        assertEq(funded, 30e6);
        assertEq(pt.totalEscrowLiability(), 30e6);

        vm.prank(alice); pt.fund(ORDER_A, 30e6);
        (,uint256 c2,) = pt.getContribution(ORDER_A, alice);
        assertEq(c2, 60e6);
        assertEq(pt.totalEscrowLiability(), 60e6);
    }

    function test_fund_unequalShares_60_25_15() public {
        _createOrder100(ORDER_A);
        _fullFund(ORDER_A);
        (,uint256 ca,) = pt.getContribution(ORDER_A, alice);
        (,uint256 cb,) = pt.getContribution(ORDER_A, bob);
        (,uint256 cc,) = pt.getContribution(ORDER_A, carol);
        assertEq(ca, 60e6);
        assertEq(cb, 25e6);
        assertEq(cc, 15e6);
        (,,,,,uint256 funded) = pt.getOrder(ORDER_A);
        assertEq(funded, 100e6);
        assertEq(pt.totalEscrowLiability(), 100e6);
    }

    function test_fund_rejectsExceedShare() public {
        _createOrder100(ORDER_A);
        vm.prank(alice);
        vm.expectRevert(PayTogether.ExceedsShare.selector);
        pt.fund(ORDER_A, 61e6);
    }

    function test_fund_rejectsExceedTarget() public {
        address[] memory cs = new address[](1); uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = 100e6;
        vm.prank(organizer);
        pt.createOrder(ORDER_B, merchant, 100e6, deadline, "b", cs, ss);
        vm.prank(alice); pt.fund(ORDER_B, 50e6);
        vm.prank(alice);
        vm.expectRevert(PayTogether.ExceedsShare.selector);
        pt.fund(ORDER_B, 51e6);
    }

    /// Fund exactly at deadline (== deadline) must fail.
    function test_fund_rejectsAtDeadline() public {
        _createOrder100(ORDER_A);
        vm.warp(deadline); // block.timestamp == deadline → DeadlinePassed
        vm.prank(alice);
        vm.expectRevert(PayTogether.DeadlinePassed.selector);
        pt.fund(ORDER_A, 10e6);
    }

    /// Fund at deadline - 1 must succeed.
    function test_fund_allowsAtDeadlineMinus1() public {
        _createOrder100(ORDER_A);
        vm.warp(deadline - 1);
        vm.prank(alice);
        pt.fund(ORDER_A, 10e6);
        (,uint256 c,) = pt.getContribution(ORDER_A, alice);
        assertEq(c, 10e6);
    }

    function test_fund_rejectsAfterDeadline() public {
        _createOrder100(ORDER_A);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(PayTogether.DeadlinePassed.selector);
        pt.fund(ORDER_A, 10e6);
    }

    function test_fund_rejectsUnknownContributor() public {
        _createOrder100(ORDER_A);
        vm.prank(stranger);
        vm.expectRevert(PayTogether.NotAContributor.selector);
        pt.fund(ORDER_A, 1e6);
    }

    function test_fund_rejectsZeroAmount() public {
        _createOrder100(ORDER_A);
        vm.prank(alice);
        vm.expectRevert(PayTogether.ZeroAmount.selector);
        pt.fund(ORDER_A, 0);
    }

    function test_fund_rejectsUnknownOrder() public {
        vm.prank(alice);
        vm.expectRevert(PayTogether.OrderNotFound.selector);
        pt.fund(keccak256("none"), 1e6);
    }

    // ── Settlement ────────────────────────────────────────────────────────────

    function test_settle_afterFullFund() public {
        _createOrder100(ORDER_A);
        _fullFund(ORDER_A);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        pt.settle(ORDER_A);
        assertEq(usdc.balanceOf(merchant) - merchantBefore, 100e6);
        assertEq(pt.totalEscrowLiability(), 0);
        (,,,,bool settled,) = pt.getOrder(ORDER_A);
        assertTrue(settled);
    }

    function test_settle_permissionless() public {
        _createOrder100(ORDER_A);
        _fullFund(ORDER_A);
        vm.prank(stranger);
        pt.settle(ORDER_A);
        (,,,,bool settled,) = pt.getOrder(ORDER_A);
        assertTrue(settled);
    }

    function test_settle_rejectsNotFullyFunded() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 60e6);
        vm.expectRevert(PayTogether.NotFullyFunded.selector);
        pt.settle(ORDER_A);
    }

    function test_settle_rejectsDoubleSettle() public {
        _createOrder100(ORDER_A);
        _fullFund(ORDER_A);
        pt.settle(ORDER_A);
        vm.expectRevert(PayTogether.AlreadySettled.selector);
        pt.settle(ORDER_A);
    }

    /// Fully funded before deadline → settle must succeed after deadline.
    function test_settle_afterDeadlineIfFullyFunded() public {
        _createOrder100(ORDER_A);
        _fullFund(ORDER_A);
        vm.warp(deadline + 1 hours);
        pt.settle(ORDER_A);
        (,,,,bool settled,) = pt.getOrder(ORDER_A);
        assertTrue(settled);
    }

    function test_settle_rejectsUnknownOrder() public {
        vm.expectRevert(PayTogether.OrderNotFound.selector);
        pt.settle(keccak256("ghost"));
    }

    // ── Outgoing-transfer failure on settle ───────────────────────────────────

    /// settle(): reverting transfer → settled=false, liability restored, retry succeeds.
    function test_settle_outgoing_revert_rollsBack_retrySucceeds() public {
        RevertToken rt = new RevertToken();
        PayTogether newPt = _setupSingleActorOrder(rt, ORDER_A, alice, 50e6);
        rt.mint(alice, 200e6);
        vm.prank(alice); rt.approve(address(newPt), type(uint256).max);
        vm.prank(alice); newPt.fund(ORDER_A, 50e6);

        // Arm outgoing transfer revert
        rt.setRevertTransfer(true);
        uint256 liabilityBefore = newPt.totalEscrowLiability();
        vm.expectRevert();
        newPt.settle(ORDER_A);

        // Effects must be rolled back: settled=false, liability unchanged
        (,,,,bool s,) = newPt.getOrder(ORDER_A);
        assertFalse(s, "settled must be false after failed settle");
        assertEq(newPt.totalEscrowLiability(), liabilityBefore, "liability changed on failed settle");

        // Disarm and retry — must succeed
        rt.setRevertTransfer(false);
        uint256 mBefore = rt.balanceOf(merchant);
        newPt.settle(ORDER_A);
        (,,,,bool s2,) = newPt.getOrder(ORDER_A);
        assertTrue(s2, "settled must be true after retry");
        assertEq(newPt.totalEscrowLiability(), 0);
        assertEq(rt.balanceOf(merchant) - mBefore, 50e6);
    }

    /// settle(): false-return outgoing transfer → settled=false, liability unchanged, retry succeeds.
    /// Uses FalseOutboundToken: transferFrom (inbound) works, transfer (outgoing) returns false when armed.
    function test_settle_outgoing_falseReturn_rollsBack_retrySucceeds() public {
        FalseOutboundToken ft = new FalseOutboundToken();
        PayTogether newPt = _setupSingleActorOrder(ft, ORDER_A, alice, 50e6);
        ft.mint(alice, 200e6);
        vm.prank(alice); ft.approve(address(newPt), type(uint256).max);
        vm.prank(alice); newPt.fund(ORDER_A, 50e6); // fund succeeds: transferFrom works
        assertEq(newPt.totalEscrowLiability(), 50e6);

        // Arm false outgoing transfer
        ft.setFalseOutbound(true);
        uint256 liabilityBefore = newPt.totalEscrowLiability();
        vm.expectRevert(); // SafeERC20 reverts on false-return
        newPt.settle(ORDER_A);

        // Rolled back: settled=false, liability unchanged, merchant got nothing
        (,,,,bool s,) = newPt.getOrder(ORDER_A);
        assertFalse(s, "settled must be false after false-return");
        assertEq(newPt.totalEscrowLiability(), liabilityBefore, "liability changed");
        assertEq(ft.balanceOf(merchant), 0, "merchant must have received nothing");

        // Disarm and retry — must succeed
        ft.setFalseOutbound(false);
        uint256 mBefore = ft.balanceOf(merchant);
        newPt.settle(ORDER_A);
        (,,,,bool s2,) = newPt.getOrder(ORDER_A);
        assertTrue(s2, "settled must be true after retry");
        assertEq(newPt.totalEscrowLiability(), 0);
        assertEq(ft.balanceOf(merchant) - mBefore, 50e6);
    }

    // ── Outgoing-transfer failure on refund ───────────────────────────────────

    /// refund(): reverting transfer → refunded=false, liability restored, retry succeeds.
    /// Uses a 2-contributor order where alice funds only her share and bob never funds,
    /// so the order is incomplete after deadline (totalFunded < target).
    function test_refund_outgoing_revert_rollsBack_retrySucceeds() public {
        RevertToken rt = new RevertToken();
        rt.mint(alice, 1_000_000e6);
        // 2-contributor order: alice 50e6, bob 50e6. Only alice funds.
        PayTogether newPt = new PayTogether(address(rt));
        {
            address[] memory cs2 = new address[](2);
            uint256[] memory ss2 = new uint256[](2);
            cs2[0] = alice; ss2[0] = 50e6;
            cs2[1] = bob;   ss2[1] = 50e6;
            vm.prank(organizer);
            newPt.createOrder(ORDER_A, merchant, 100e6, deadline, "rr", cs2, ss2);
        }
        vm.prank(alice); rt.approve(address(newPt), type(uint256).max);
        vm.prank(alice); newPt.fund(ORDER_A, 50e6);
        // bob never funds → totalFunded (50e6) < target (100e6) → refund is valid after deadline

        vm.warp(deadline + 1);

        // Arm outgoing transfer revert
        rt.setRevertTransfer(true);
        uint256 liabilityBefore = newPt.totalEscrowLiability();
        uint256 aliceBalBefore  = rt.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert();
        newPt.refund(ORDER_A);

        // Effects must be rolled back: refunded=false, liability unchanged
        (,, bool refunded) = newPt.getContribution(ORDER_A, alice);
        assertFalse(refunded, "refunded must be false after failed refund");
        assertEq(newPt.totalEscrowLiability(), liabilityBefore, "liability changed on failed refund");
        assertEq(rt.balanceOf(alice), aliceBalBefore, "alice balance changed on failed refund");

        // Disarm and retry — must succeed
        rt.setRevertTransfer(false);
        vm.prank(alice); newPt.refund(ORDER_A);
        (,, bool refunded2) = newPt.getContribution(ORDER_A, alice);
        assertTrue(refunded2, "refunded must be true after retry");
        assertEq(newPt.totalEscrowLiability(), 0);
        assertEq(rt.balanceOf(alice) - aliceBalBefore, 50e6);
    }

    /// refund(): false-return outgoing transfer → refunded=false, liability unchanged, retry succeeds.
    /// Uses FalseOutboundToken so fund() (transferFrom) succeeds but refund() (transfer) returns false.
    /// Two-contributor order: alice funds 50e6, bob never funds → refund valid after deadline.
    function test_refund_outgoing_falseReturn_rollsBack_retrySucceeds() public {
        FalseOutboundToken ft = new FalseOutboundToken();
        ft.mint(alice, 1_000_000e6);
        PayTogether newPt = new PayTogether(address(ft));
        {
            address[] memory cs2 = new address[](2);
            uint256[] memory ss2 = new uint256[](2);
            cs2[0] = alice; ss2[0] = 50e6;
            cs2[1] = bob;   ss2[1] = 50e6;
            vm.prank(organizer);
            newPt.createOrder(ORDER_A, merchant, 100e6, deadline, "fr2", cs2, ss2);
        }
        vm.prank(alice); ft.approve(address(newPt), type(uint256).max);
        vm.prank(alice); newPt.fund(ORDER_A, 50e6); // transferFrom works
        // bob never funds → totalFunded (50e6) < target (100e6) → refund valid after deadline

        vm.warp(deadline + 1);

        // Arm false outgoing transfer
        ft.setFalseOutbound(true);
        uint256 liabilityBefore = newPt.totalEscrowLiability();
        uint256 aliceBalBefore  = ft.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(); // SafeERC20 reverts on false-return
        newPt.refund(ORDER_A);

        // Rolled back: refunded=false, liability unchanged, alice balance unchanged
        (,, bool refunded) = newPt.getContribution(ORDER_A, alice);
        assertFalse(refunded, "refunded must be false after false-return");
        assertEq(newPt.totalEscrowLiability(), liabilityBefore, "liability changed");
        assertEq(ft.balanceOf(alice), aliceBalBefore, "alice balance changed");

        // Disarm and retry — must succeed
        ft.setFalseOutbound(false);
        vm.prank(alice); newPt.refund(ORDER_A);
        (,, bool refunded2) = newPt.getContribution(ORDER_A, alice);
        assertTrue(refunded2, "refunded must be true after retry");
        assertEq(newPt.totalEscrowLiability(), 0);
        assertEq(ft.balanceOf(alice) - aliceBalBefore, 50e6);
    }

    // ── Refund boundary cases ─────────────────────────────────────────────────

    /// Refund exactly at deadline (== deadline) must succeed.
    function test_refund_succeedsAtExactDeadline() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 60e6);
        vm.warp(deadline); // block.timestamp == deadline → refund allowed (>=)
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice); pt.refund(ORDER_A);
        assertEq(usdc.balanceOf(alice) - before, 60e6);
    }

    /// Refund at deadline - 1 must fail.
    function test_refund_failsBeforeDeadline() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 60e6);
        vm.warp(deadline - 1);
        vm.prank(alice);
        vm.expectRevert(PayTogether.DeadlineNotReached.selector);
        pt.refund(ORDER_A);
    }

    function test_refund_incompleteAfterDeadline() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 60e6);
        vm.prank(bob);   pt.fund(ORDER_A, 25e6);
        vm.warp(deadline + 1);
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);
        vm.prank(alice); pt.refund(ORDER_A);
        vm.prank(bob);   pt.refund(ORDER_A);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 60e6);
        assertEq(usdc.balanceOf(bob)   - bobBefore,   25e6);
        assertEq(pt.totalEscrowLiability(), 0);
    }

    function test_refund_exactContributionOnly() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 30e6);
        vm.warp(deadline + 1);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice); pt.refund(ORDER_A);
        assertEq(usdc.balanceOf(alice) - before, 30e6);
    }

    function test_refund_rejectsSettledOrder() public {
        _createOrder100(ORDER_A);
        _fullFund(ORDER_A);
        pt.settle(ORDER_A);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(PayTogether.AlreadySettled.selector);
        pt.refund(ORDER_A);
    }

    function test_refund_rejectsFullyFundedUnsettled() public {
        _createOrder100(ORDER_A);
        _fullFund(ORDER_A);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(PayTogether.OrderFullyFunded.selector);
        pt.refund(ORDER_A);
    }

    function test_refund_rejectsDoubleRefund() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 60e6);
        vm.warp(deadline + 1);
        vm.prank(alice); pt.refund(ORDER_A);
        vm.prank(alice);
        vm.expectRevert(PayTogether.AlreadyRefunded.selector);
        pt.refund(ORDER_A);
    }

    function test_refund_rejectsNothingToRefund() public {
        _createOrder100(ORDER_A);
        vm.warp(deadline + 1);
        vm.prank(carol); // carol never funded
        vm.expectRevert(PayTogether.NothingToRefund.selector);
        pt.refund(ORDER_A);
    }

    function test_refund_selfOnly_strangerRejected() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 60e6);
        vm.warp(deadline + 1);
        vm.prank(stranger);
        vm.expectRevert(PayTogether.NothingToRefund.selector);
        pt.refund(ORDER_A);
    }

    function test_refund_rejectsUnknownOrder() public {
        vm.warp(deadline + 1);
        vm.expectRevert(PayTogether.OrderNotFound.selector);
        pt.refund(keccak256("unknown"));
    }

    // ── No early settlement ───────────────────────────────────────────────────

    function test_noEarlySettlement_partialFund() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, 60e6);
        vm.expectRevert(PayTogether.NotFullyFunded.selector);
        pt.settle(ORDER_A);
    }

    // ── Independent multiple orders ───────────────────────────────────────────

    function test_multipleOrders_independent() public {
        _createOrder100(ORDER_A);
        address[] memory cs2 = new address[](1); uint256[] memory ss2 = new uint256[](1);
        cs2[0] = alice; ss2[0] = 50e6;
        vm.prank(organizer);
        pt.createOrder(ORDER_B, merchant, 50e6, deadline, "inv-002", cs2, ss2);

        vm.prank(alice); pt.fund(ORDER_B, 50e6);
        vm.prank(alice); pt.fund(ORDER_A, 60e6);

        pt.settle(ORDER_B);
        (,,,,bool settledA,) = pt.getOrder(ORDER_A);
        assertFalse(settledA);
        assertEq(pt.totalEscrowLiability(), 60e6);
    }

    // ── Failed ERC-20 transfers (fund path) ───────────────────────────────────

    function test_fund_rejectsRevertingToken() public {
        RevertToken rt = new RevertToken();
        rt.mint(alice, 1000e6);
        PayTogether newPt = _setupSingleActorOrder(rt, ORDER_A, alice, 100e6);
        vm.prank(alice); rt.approve(address(newPt), type(uint256).max);
        rt.setRevertTransferFrom(true);
        vm.prank(alice);
        vm.expectRevert();
        newPt.fund(ORDER_A, 100e6);
        assertEq(newPt.totalEscrowLiability(), 0);
        (,uint256 contrib,) = newPt.getContribution(ORDER_A, alice);
        assertEq(contrib, 0);
    }

    function test_fund_rejectsFalseReturnToken() public {
        FalseReturnToken ft = new FalseReturnToken();
        ft.mint(alice, 1000e6);
        PayTogether newPt = _setupSingleActorOrder(ft, ORDER_A, alice, 100e6);
        vm.prank(alice); ft.approve(address(newPt), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert();
        newPt.fund(ORDER_A, 100e6);
        assertEq(newPt.totalEscrowLiability(), 0);
    }

    function test_fund_rejectsFeeOnTransferToken() public {
        FeeToken fee = new FeeToken();
        fee.mint(alice, 1000e6);
        PayTogether newPt = _setupSingleActorOrder(fee, ORDER_A, alice, 100e6);
        vm.prank(alice); fee.approve(address(newPt), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(PayTogether.TokenTransferShort.selector);
        newPt.fund(ORDER_A, 100e6);
        assertEq(newPt.totalEscrowLiability(), 0);
        (,uint256 contrib,) = newPt.getContribution(ORDER_A, alice);
        assertEq(contrib, 0);
    }

    // ── Accounting / accidental transfer ─────────────────────────────────────

    function test_accidentalTransfer_doesNotInflateLiability() public {
        _createOrder100(ORDER_A);
        vm.prank(alice); usdc.transfer(address(pt), 1000e6);
        assertEq(pt.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(pt)), 1000e6);
        _fullFund(ORDER_A);
        assertEq(pt.totalEscrowLiability(), 100e6); // not 1100
        pt.settle(ORDER_A);
        assertEq(pt.totalEscrowLiability(), 0);
    }

    // ── Reentrancy: callback-attempt tests ───────────────────────────────────
    //
    // All three tests use CallbackToken whose transfer() fires attacker.onTokenCallback()
    // after the tokens move. The callback arrives mid-refund/settle (after CEI effects,
    // during the safeTransfer call). ReentrancyGuard must block the nested call.
    //
    // Pattern:
    //   1. Fund the order (transferFrom path — no callback).
    //   2. Arm the token's callback.
    //   3. Call the outer function (refund/settle).
    //   4. Assert: callback WAS attempted, nested call WAS reverted by ReentrancyGuard,
    //      outer call completed (succeeded once), balances and liability correct.

    // ─── Reentrancy callback-attempt tests ───────────────────────────────────
    //
    // Pattern (same for all three tests):
    //   1. Create PayTogether backed by CallbackToken.
    //   2. Create ReentrancyAttacker pointing at that PayTogether (BEFORE createOrder).
    //   3. Wire ct.setAttacker(attacker) so the callback targets the right instance.
    //   4. Create the order with address(attacker) as contributor.
    //   5. Fund (transferFrom — no callback on inbound).
    //   6. Arm, call outer function, assert nested call attempted AND blocked.

    /// Nested refund during refund callback: outer refund completes; re-entered refund blocked.
    function test_reentrancy_nestedRefund_blockedByGuard() public {
        // Create attacker pointing at the PayTogether BEFORE creating the order.
        // This ensures address(attacker) is the correct contributor address.
        CallbackToken ct2 = new CallbackToken();
        PayTogether newPt2 = new PayTogether(address(ct2));
        ReentrancyAttacker att2 = new ReentrancyAttacker(newPt2);
        ct2.setAttacker(att2);
        att2.setMode(ReentrancyAttacker.AttackMode.Refund);

        bytes32 ordId = keccak256("re-refund");
        {
            address[] memory cs2 = new address[](2);
            uint256[] memory ss2 = new uint256[](2);
            cs2[0] = address(att2); ss2[0] = 60e6;
            cs2[1] = address(0xDEAD); ss2[1] = 40e6;
            vm.prank(organizer);
            newPt2.createOrder(ordId, merchant, 100e6, deadline, "re3", cs2, ss2);
        }
        att2.setOrder(ordId);

        ct2.mint(address(att2), 1000e6);
        vm.prank(address(att2)); ct2.approve(address(newPt2), type(uint256).max);
        vm.prank(address(att2)); newPt2.fund(ordId, 60e6);
        assertEq(newPt2.totalEscrowLiability(), 60e6);

        vm.warp(deadline + 1);
        ct2.arm();
        uint256 balBefore = ct2.balanceOf(address(att2));
        vm.prank(address(att2)); newPt2.refund(ordId);

        assertTrue(att2.nestedRefundAttempted(), "nested refund not attempted");
        assertTrue(att2.nestedRefundReverted(), "nested refund not blocked");
        // Assert the exact selector — proves the ReentrancyGuard blocked it, not another gate
        assertEq(
            bytes4(att2.nestedRefundRevertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "nested refund must revert with ReentrancyGuardReentrantCall"
        );
        assertEq(ct2.balanceOf(address(att2)) - balBefore, 60e6);
        assertEq(newPt2.totalEscrowLiability(), 0);
        // Prove the blocking error IS ReentrancyGuardReentrantCall, not some other gate:
        // Re-arm the token to fire the callback again, but this time with the guard NOT locked
        // (outer call is done). The nested refund would now hit AlreadyRefunded — which is
        // distinct from ReentrancyGuardReentrantCall. To prove the guard was what blocked during
        // re-entrancy, we directly call a non-re-entrant refund and confirm it gets AlreadyRefunded,
        // while a re-entrant call during an active nonReentrant frame gets ReentrancyGuardReentrantCall.
        // Direct proof: deploy a fresh attacker that calls refund inside refund's safeTransfer.
        CallbackToken ct3 = new CallbackToken();
        PayTogether newPt3 = new PayTogether(address(ct3));
        ReentrancyAttacker att3 = new ReentrancyAttacker(newPt3);
        ct3.setAttacker(att3);
        att3.setMode(ReentrancyAttacker.AttackMode.Refund);
        bytes32 ordId3 = keccak256("re-guard-proof");
        // Use block.timestamp + 2 days so the deadline is always in the future regardless
        // of any vm.warp calls earlier in this test.
        uint256 freshDeadline = block.timestamp + 2 days;
        {
            address[] memory cs3 = new address[](2);
            uint256[] memory ss3 = new uint256[](2);
            cs3[0] = address(att3); ss3[0] = 60e6;
            cs3[1] = address(0xDEAD2); ss3[1] = 40e6;
            vm.prank(organizer);
            newPt3.createOrder(ordId3, merchant, 100e6, freshDeadline, "guard-proof", cs3, ss3);
        }
        att3.setOrder(ordId3);
        ct3.mint(address(att3), 1000e6);
        vm.prank(address(att3)); ct3.approve(address(newPt3), type(uint256).max);
        vm.prank(address(att3)); newPt3.fund(ordId3, 60e6);
        vm.warp(freshDeadline + 1);
        // Arm callback and call refund — nested refund mid-safeTransfer must get ReentrancyGuardReentrantCall
        ct3.arm();
        // The outer refund succeeds; the nested one is caught. Now prove selector by direct call
        // while re-entrancy guard is locked: we do this by checking the try/catch captured it,
        // then separately prove that calling refund normally post-completion gives AlreadyRefunded
        vm.prank(address(att3)); newPt3.refund(ordId3);
        assertTrue(att3.nestedRefundReverted(), "guard proof: nested refund must revert");
        // Post-completion: direct call gives AlreadyRefunded (not ReentrancyGuardReentrantCall)
        vm.prank(address(att3));
        vm.expectRevert(PayTogether.AlreadyRefunded.selector);
        newPt3.refund(ordId3);
    }

    /// Nested settle during refund callback: outer refund completes; nested settle blocked.
    /// Attacker is known before createOrder — create the order AFTER the final attacker address.
    function test_reentrancy_nestedSettle_duringRefund_blocked() public {
        CallbackToken ct = new CallbackToken();
        PayTogether newPt = new PayTogether(address(ct));
        // Final attacker points at newPt from the start; create order after.
        ReentrancyAttacker att = new ReentrancyAttacker(newPt);
        ct.setAttacker(att);
        att.setMode(ReentrancyAttacker.AttackMode.Settle);

        // Create 2-contributor order with att as contributor (order created AFTER attacker)
        bytes32 ordId = keccak256("re-settle");
        {
            address[] memory cs = new address[](2);
            uint256[] memory ss = new uint256[](2);
            cs[0] = address(att); ss[0] = 60e6;
            cs[1] = address(0xDEAD); ss[1] = 40e6;
            vm.prank(organizer);
            newPt.createOrder(ordId, merchant, 100e6, deadline, "res", cs, ss);
        }
        att.setOrder(ordId);

        ct.mint(address(att), 1000e6);
        vm.prank(address(att)); ct.approve(address(newPt), type(uint256).max);
        vm.prank(address(att)); newPt.fund(ordId, 60e6);

        vm.warp(deadline + 1);
        ct.arm();
        vm.prank(address(att)); newPt.refund(ordId);

        assertTrue(att.nestedSettleAttempted(), "nested settle not attempted");
        assertTrue(att.nestedSettleReverted(), "nested settle not blocked");
        assertEq(
            bytes4(att.nestedSettleRevertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "nested settle must revert with ReentrancyGuardReentrantCall"
        );
        assertEq(newPt.totalEscrowLiability(), 0);
    }

    /// Nested fund during settle callback: outer settle completes; nested fund blocked.
    function test_reentrancy_nestedFund_duringSettle_blocked() public {
        CallbackToken ct = new CallbackToken();
        PayTogether newPt = new PayTogether(address(ct));
        ReentrancyAttacker att = new ReentrancyAttacker(newPt);
        ct.setAttacker(att);
        att.setMode(ReentrancyAttacker.AttackMode.Fund);

        bytes32 ordId = keccak256("re-fund");
        {
            address[] memory cs = new address[](1);
            uint256[] memory ss = new uint256[](1);
            cs[0] = address(att); ss[0] = 100e6;
            vm.prank(organizer);
            newPt.createOrder(ordId, merchant, 100e6, deadline, "ref", cs, ss);
        }
        att.setOrder(ordId);
        att.setFundParams(ordId, 1); // try to fund 1 more (already fully funded → ExceedsShare)

        ct.mint(address(att), 1000e6);
        vm.prank(address(att)); ct.approve(address(newPt), type(uint256).max);
        vm.prank(address(att)); newPt.fund(ordId, 100e6);

        ct.arm();
        newPt.settle(ordId); // permissionless

        assertTrue(att.nestedFundAttempted(), "nested fund not attempted");
        assertTrue(att.nestedFundReverted(), "nested fund not blocked");
        assertEq(
            bytes4(att.nestedFundRevertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "nested fund must revert with ReentrancyGuardReentrantCall"
        );
        assertEq(ct.balanceOf(merchant), 100e6);
        assertEq(newPt.totalEscrowLiability(), 0);
        (,,,,bool settled,) = newPt.getOrder(ordId);
        assertTrue(settled);
    }

    // ── Fuzz tests (using bound(), not vm.assume) ──────────────────────────────

    /// Fuzz: liability always equals contribution after fund.
    function testFuzz_liability_matchesContributions(uint96 fundAmt) public {
        _createOrder100(ORDER_A);
        uint256 amt = bound(uint256(fundAmt), 1, 60e6);
        uint256 liabilityBefore = pt.totalEscrowLiability();
        vm.prank(alice); pt.fund(ORDER_A, amt);
        assertEq(pt.totalEscrowLiability() - liabilityBefore, amt);
        (,uint256 contrib,) = pt.getContribution(ORDER_A, alice);
        assertEq(contrib, amt);
    }

    /// Fuzz: settle always transfers exactly target to merchant.
    function testFuzz_settle_exactTransfer(uint96 target_) public {
        uint256 tgt = bound(uint256(target_), 1, type(uint96).max);
        usdc.mint(alice, tgt);
        vm.prank(alice); usdc.approve(address(pt), type(uint256).max);
        address[] memory cs = new address[](1); uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = tgt;
        vm.prank(organizer);
        pt.createOrder(ORDER_A, merchant, tgt, deadline, "fuzz", cs, ss);
        vm.prank(alice); pt.fund(ORDER_A, tgt);
        uint256 mBefore = usdc.balanceOf(merchant);
        pt.settle(ORDER_A);
        assertEq(usdc.balanceOf(merchant) - mBefore, tgt);
        assertEq(pt.totalEscrowLiability(), 0);
    }

    /// Fuzz: contributor never gets back more than funded; double-refund blocked.
    function testFuzz_noDoubleSpend_refund(uint96 fundAmt_) public {
        uint256 fundAmt = bound(uint256(fundAmt_), 1, 60e6);
        _createOrder100(ORDER_A);
        vm.prank(alice); pt.fund(ORDER_A, fundAmt);
        vm.warp(deadline + 1);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice); pt.refund(ORDER_A);
        uint256 received = usdc.balanceOf(alice) - before;
        assertEq(received, fundAmt);
        vm.prank(alice);
        vm.expectRevert(PayTogether.AlreadyRefunded.selector);
        pt.refund(ORDER_A);
    }
}
