// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Kitty} from "../Kitty.sol";

// ─── Helper tokens (all prefixed Kitty to avoid clashes with legacy tests) ───

contract KittyMockUSDC is ERC20 {
    constructor() ERC20("Kitty Mock USDC", "kUSDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// Fee-on-transfer: burns 1 unit from the sender, recipient receives value - 1.
contract KittyFeeToken is ERC20 {
    constructor() ERC20("Kitty Fee", "kFEE") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _burn(from, 1);
        return super.transferFrom(from, to, value - 1);
    }
}

/// Reverts on transferFrom (inbound) and/or transfer (outbound) when armed.
contract KittyRevertToken is ERC20 {
    bool public revertTransferFrom;
    bool public revertTransfer;
    constructor() ERC20("Kitty Revert", "kREV") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setRevertTransferFrom(bool v) external { revertTransferFrom = v; }
    function setRevertTransfer(bool v) external { revertTransfer = v; }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        require(!revertTransferFrom, "KittyRevertToken: transferFrom failed");
        return super.transferFrom(from, to, value);
    }
    function transfer(address to, uint256 value) public override returns (bool) {
        require(!revertTransfer, "KittyRevertToken: transfer failed");
        return super.transfer(to, value);
    }
}

/// transferFrom ALWAYS returns false (inbound path rejected).
contract KittyFalseReturnToken is ERC20 {
    constructor() ERC20("Kitty False", "kFALSE") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// transferFrom works; transfer returns false when armed (outbound settle/refund path).
contract KittyFalseOutboundToken is ERC20 {
    bool public falseOutbound;
    constructor() ERC20("Kitty False Outbound", "kFOUT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setFalseOutbound(bool v) external { falseOutbound = v; }
    function transfer(address to, uint256 value) public override returns (bool) {
        if (falseOutbound) return false;
        return super.transfer(to, value);
    }
}

/// Recipient-specific transfer revert (models a USDC-style blocklist).
/// Reverts transfer()/transferFrom() whenever the destination is blocked.
contract KittyBlocklistToken is ERC20 {
    mapping(address => bool) public blocked;
    constructor() ERC20("Kitty Blocklist", "kBLK") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setBlocked(address who, bool v) external { blocked[who] = v; }

    function transfer(address to, uint256 value) public override returns (bool) {
        require(!blocked[to], "KittyBlocklistToken: recipient blocklisted");
        return super.transfer(to, value);
    }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        require(!blocked[to], "KittyBlocklistToken: recipient blocklisted");
        return super.transferFrom(from, to, value);
    }
}

// ─── Reentrancy helpers ──────────────────────────────────────────────────────

contract KittyReentrancyAttacker {
    enum Attack { None, Fund, Settle, Refund }

    Kitty   public immutable kitty;
    Attack  public attack;
    bytes32 public targetPot;
    uint256 public attackAmount;

    bool  public attempted;
    bool  public reverted;
    bool  public succeeded;
    bytes public revertData;

    constructor(Kitty k) { kitty = k; }

    function configure(Attack a, bytes32 potId, uint256 amount) external {
        attack = a;
        targetPot = potId;
        attackAmount = amount;
    }

    function approveToken(ERC20 t) external { t.approve(address(kitty), type(uint256).max); }
    function fundPot(bytes32 potId, uint256 amt) external { kitty.fund(potId, amt); }
    function refundPot(bytes32 potId) external { kitty.refund(potId); }
    function settlePot(bytes32 potId) external { kitty.settle(potId); }

    /// Invoked by the token mid-transfer.
    function onTokenCallback() external {
        if (attack == Attack.None) return;
        attempted = true;
        if (attack == Attack.Fund) {
            try kitty.fund(targetPot, attackAmount) { succeeded = true; }
            catch (bytes memory d) { reverted = true; revertData = d; }
        } else if (attack == Attack.Settle) {
            try kitty.settle(targetPot) { succeeded = true; }
            catch (bytes memory d) { reverted = true; revertData = d; }
        } else {
            try kitty.refund(targetPot) { succeeded = true; }
            catch (bytes memory d) { reverted = true; revertData = d; }
        }
    }
}

/// One-shot hook on outbound transfer() and/or inbound transferFrom().
contract KittyCallbackToken is ERC20 {
    KittyReentrancyAttacker public hookTarget;
    bool public hookOnTransfer;
    bool public hookOnTransferFrom;

    constructor() ERC20("Kitty Callback", "kCB") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setTarget(KittyReentrancyAttacker a) external { hookTarget = a; }
    function arm(bool onTransfer, bool onTransferFrom) external {
        hookOnTransfer = onTransfer;
        hookOnTransferFrom = onTransferFrom;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        bool ok = super.transfer(to, value);
        if (hookOnTransfer && address(hookTarget) != address(0)) {
            hookOnTransfer = false;
            hookTarget.onTokenCallback();
        }
        return ok;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        bool ok = super.transferFrom(from, to, value);
        if (hookOnTransferFrom && address(hookTarget) != address(0)) {
            hookOnTransferFrom = false;
            hookTarget.onTokenCallback();
        }
        return ok;
    }
}

// ─── Shared test base (no test functions here) ───────────────────────────────

abstract contract KittyTestBase is Test {
    Kitty        internal kitty;
    KittyMockUSDC internal usdc;

    address internal creator   = makeAddr("creator");
    address internal recipient = makeAddr("recipient");
    address internal alice     = makeAddr("alice");
    address internal bob       = makeAddr("bob");
    address internal carol     = makeAddr("carol");
    address internal dave      = makeAddr("dave");
    address internal stranger  = makeAddr("stranger");

    uint64  internal deadline;
    uint256 internal constant GOAL = 100e6;
    bytes32 internal constant SALT_A = keccak256("kitty-salt-a");
    bytes32 internal constant SALT_B = keccak256("kitty-salt-b");

    function setUp() public virtual {
        usdc = new KittyMockUSDC();
        kitty = new Kitty(address(usdc));
        deadline = uint64(block.timestamp + 1 days);

        address[5] memory users = [alice, bob, carol, dave, stranger];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], 1_000_000e6);
            vm.prank(users[i]);
            usdc.approve(address(kitty), type(uint256).max);
        }
    }

    // ── Pot builders ──────────────────────────────────────────────────────────

    /// Split pot: alice 60 / bob 25 / carol 15, goal 100e6, created by `creator`.
    function _split3(bytes32 salt) internal returns (bytes32 id) {
        address[] memory cs = new address[](3);
        uint256[] memory ss = new uint256[](3);
        cs[0] = alice; ss[0] = 60e6;
        cs[1] = bob;   ss[1] = 25e6;
        cs[2] = carol; ss[2] = 15e6;
        vm.prank(creator);
        id = kitty.createSplitPot(salt, recipient, GOAL, deadline, "inv-001", cs, ss);
    }

    function _open(bytes32 salt, uint256 goal, uint256 minC) internal returns (bytes32 id) {
        vm.prank(creator);
        id = kitty.createOpenPot(salt, recipient, goal, deadline, "open", minC);
    }

    function _fund(bytes32 id, address who, uint256 amt) internal {
        vm.prank(who);
        kitty.fund(id, amt);
    }

    function _fullFundSplit3(bytes32 id) internal {
        _fund(id, alice, 60e6);
        _fund(id, bob, 25e6);
        _fund(id, carol, 15e6);
    }

    /// Fresh funded+approved address #i.
    function _newFunder(uint256 i, uint256 bal) internal returns (address a) {
        a = address(uint160(0x10000 + i));
        usdc.mint(a, bal);
        vm.prank(a);
        usdc.approve(address(kitty), type(uint256).max);
    }

    /// Open pot fully funded: alice 75, bob 25 (alice is a repeat funder).
    function _fullOpen(bytes32 salt) internal returns (bytes32 id) {
        id = _open(salt, GOAL, 0);
        _fund(id, alice, 60e6);
        _fund(id, bob, 25e6);
        _fund(id, alice, 15e6);
    }

    /// First instant at which a fully funded unsettled pot becomes refund-only.
    function _valveTime() internal view returns (uint256) {
        return uint256(deadline) + kitty.SETTLE_GRACE();
    }

    /// ceil(goal / 256): the Open-pot dust floor before the creator minimum is applied.
    function _dust(uint256 goal) internal pure returns (uint256) {
        return (goal + 255) / 256;
    }

    // ── Read helpers ──────────────────────────────────────────────────────────

    function _totalFunded(Kitty k, bytes32 id) internal view returns (uint256 t) {
        (,,,,,,, t,,,) = k.getPot(id);
    }

    function _totalFunded(bytes32 id) internal view returns (uint256) {
        return _totalFunded(kitty, id);
    }

    function _settled(bytes32 id) internal view returns (bool s) {
        (,,,,,, s,,,,) = kitty.getPot(id);
    }

    function _count(bytes32 id) internal view returns (uint256 c) {
        (,,,,,,,,, c,) = kitty.getPot(id);
    }

    function _contributed(bytes32 id, address who) internal view returns (uint256 c) {
        (, c,) = kitty.getContribution(id, who);
    }

    function _refunded(bytes32 id, address who) internal view returns (bool r) {
        (,, r) = kitty.getContribution(id, who);
    }

    function _cancelled(bytes32 id) internal view returns (bool c) {
        (,,,,,,,,,, c) = kitty.getPot(id);
    }

    /// How many recorded logs carry `topic0` as their event signature.
    function _topicCount(Vm.Log[] memory logs, bytes32 topic0) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; i++) if (logs[i].topics[0] == topic0) n++;
    }

    /// Creator cancels `id`.
    function _cancel(bytes32 id) internal {
        vm.prank(creator);
        kitty.cancel(id);
    }

    function _fundFor(bytes32 id, address payer_, address ben, uint256 amt) internal {
        vm.prank(payer_);
        kitty.fundFor(id, ben, amt);
    }
}
