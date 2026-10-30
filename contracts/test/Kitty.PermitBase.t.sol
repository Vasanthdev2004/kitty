// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// Mock EIP-2612 token modelled on Circle USDC: name "USDC", version "2", 6 decimals.
/// Everything the permit domain needs is a code constant (no immutables, no constructor storage), so
/// `vm.etch` of its runtime code at the canonical Arc USDC address yields the live-chain domain.
contract KittyPermitToken is ERC20 {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    mapping(address => uint256) public nonces;

    constructor() ERC20("USDC", "USDC") {}

    function name() public pure override returns (string memory) { return "USDC"; }
    function decimals() public pure override returns (uint8) { return 6; }
    function version() public pure returns (string memory) { return "2"; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("USDC"), keccak256("2"), block.chainid, address(this))
        );
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        require(block.timestamp <= deadline, "KittyPermitToken: expired");
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner, "KittyPermitToken: invalid signature");
        _approve(owner, spender, value);
    }
}

/// Re-enters Kitty from a token callback and records whether the nested call was blocked.
contract KittyPermitAttacker {
    enum Attack { None, Fund, FundFor, FundWithPermit, FundForWithPermit, Settle, Refund, Cancel }

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

    function createOpen(bytes32 salt, address rec, uint256 goal, uint64 dl) external returns (bytes32) {
        return kitty.createOpenPot(salt, rec, goal, dl, "atk", 0);
    }

    function fundWithPermitPot(bytes32 potId, uint256 amt) external {
        kitty.fundWithPermit(potId, amt, type(uint256).max, 27, bytes32(0), bytes32(0));
    }

    function fundForWithPermitPot(bytes32 potId, address ben, uint256 amt) external {
        kitty.fundForWithPermit(potId, ben, amt, type(uint256).max, 27, bytes32(0), bytes32(0));
    }

    function fundPot(bytes32 potId, uint256 amt) external { kitty.fund(potId, amt); }

    function onTokenCallback() external {
        if (attack == Attack.None) return;
        attempted = true;
        bytes32 id = targetPot;
        uint256 amt = attackAmount;
        if (attack == Attack.Fund) {
            try kitty.fund(id, amt) { succeeded = true; } catch (bytes memory d) { reverted = true; revertData = d; }
        } else if (attack == Attack.FundFor) {
            try kitty.fundFor(id, address(this), amt) { succeeded = true; }
            catch (bytes memory d) { reverted = true; revertData = d; }
        } else if (attack == Attack.FundWithPermit) {
            try kitty.fundWithPermit(id, amt, type(uint256).max, 27, bytes32(0), bytes32(0)) { succeeded = true; }
            catch (bytes memory d) { reverted = true; revertData = d; }
        } else if (attack == Attack.FundForWithPermit) {
            try kitty.fundForWithPermit(id, address(this), amt, type(uint256).max, 27, bytes32(0), bytes32(0)) {
                succeeded = true;
            } catch (bytes memory d) { reverted = true; revertData = d; }
        } else if (attack == Attack.Settle) {
            try kitty.settle(id) { succeeded = true; } catch (bytes memory d) { reverted = true; revertData = d; }
        } else if (attack == Attack.Refund) {
            try kitty.refund(id) { succeeded = true; } catch (bytes memory d) { reverted = true; revertData = d; }
        } else {
            try kitty.cancel(id) { succeeded = true; } catch (bytes memory d) { reverted = true; revertData = d; }
        }
    }
}

/// Permit-capable token whose permit() (permissive: always approves) and transferFrom() call back an attacker.
contract KittyPermitHookToken is ERC20 {
    KittyPermitAttacker public hookTarget;
    bool public hookOnPermit;
    bool public hookOnTransferFrom;

    constructor() ERC20("Kitty Permit Hook", "kPH") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setTarget(KittyPermitAttacker a) external { hookTarget = a; }
    function arm(bool onPermit, bool onTransferFrom) external {
        hookOnPermit = onPermit;
        hookOnTransferFrom = onTransferFrom;
    }

    function permit(address owner, address spender, uint256 value, uint256, uint8, bytes32, bytes32) external {
        _approve(owner, spender, value);
        if (hookOnPermit && address(hookTarget) != address(0)) {
            hookOnPermit = false;
            hookTarget.onTokenCallback();
        }
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

/// Shared fixture for permit tests: Kitty `pk` runs on the permit token `pt`.
/// `payer` has a known key, tokens, and NO allowance. Others have tokens and no allowance either.
abstract contract KittyPermitTestBase is KittyTestBase {
    uint256 internal constant PDL = type(uint64).max; // permit deadline far in the future

    KittyPermitToken internal pt;
    Kitty internal pk;
    address internal payer;
    uint256 internal payerKey;

    function setUp() public virtual override {
        super.setUp();
        pt = new KittyPermitToken();
        pk = new Kitty(address(pt));
        (payer, payerKey) = makeAddrAndKey("payer");
        address[6] memory us = [payer, alice, bob, carol, dave, stranger];
        for (uint256 i = 0; i < us.length; i++) pt.mint(us[i], 1_000_000e6);
    }

    // ── builders on the permit-token kitty ───────────────────────────────────

    /// Split pot: payer 60 / bob 25 / carol 15, goal 100e6.
    function _pSplit(bytes32 salt) internal returns (bytes32 id) {
        address[] memory cs = new address[](3);
        uint256[] memory ss = new uint256[](3);
        cs[0] = payer; ss[0] = 60e6;
        cs[1] = bob;   ss[1] = 25e6;
        cs[2] = carol; ss[2] = 15e6;
        vm.prank(creator);
        id = pk.createSplitPot(salt, recipient, GOAL, deadline, "permit", cs, ss);
    }

    function _pOpen(bytes32 salt, uint256 minC) internal returns (bytes32 id) {
        vm.prank(creator);
        id = pk.createOpenPot(salt, recipient, GOAL, deadline, "permit-open", minC);
    }

    function _pCancel(bytes32 id) internal {
        vm.prank(creator);
        pk.cancel(id);
    }

    // ── signing ──────────────────────────────────────────────────────────────

    function _signOn(KittyPermitToken tok, uint256 key, address owner_, address spender, uint256 value, uint256 dl)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(tok.PERMIT_TYPEHASH(), owner_, spender, value, tok.nonces(owner_), dl));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", tok.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(key, digest);
    }

    /// Payer's valid permit for `pk` (current nonce).
    function _sig(uint256 amount) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        return _signOn(pt, payerKey, payer, address(pk), amount, PDL);
    }

    function _pContributed(bytes32 id, address who) internal view returns (uint256 c) {
        (, c,) = pk.getContribution(id, who);
    }

    function _pTotal(bytes32 id) internal view returns (uint256 t) {
        (,,,,,,, t,,,) = pk.getPot(id);
    }
}
