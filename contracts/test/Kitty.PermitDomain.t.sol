// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyPermitToken, KittyPermitTestBase} from "./Kitty.PermitBase.t.sol";

/// Real-domain permit tests: the mock's runtime code is etched at the canonical Arc USDC address on
/// chain id 5042002, so its EIP-712 domain equals the live Arc Testnet USDC domain used by the frontend.
contract KittyPermitArcDomainTest is KittyPermitTestBase {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_CHAIN_ID = 5042002;
    /// DOMAIN_SEPARATOR() read from live Arc Testnet USDC.
    bytes32 internal constant LIVE_DOMAIN_SEPARATOR =
        0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant PERMIT_TH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    KittyPermitToken internal arcUsdc;
    Kitty internal arc;

    function setUp() public override {
        super.setUp();
        vm.chainId(ARC_CHAIN_ID);
        vm.etch(ARC_USDC, address(pt).code);
        arcUsdc = KittyPermitToken(ARC_USDC);
        arcUsdc.mint(payer, 1_000_000e6);
        arc = new Kitty(ARC_USDC);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _ds(string memory name_, string memory version_, uint256 chainId_, address vc) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name_)), keccak256(bytes(version_)), chainId_, vc));
    }

    /// Digest built entirely from test constants (independent of the token's own DOMAIN_SEPARATOR()).
    function _sigWithDomain(bytes32 domainSep, uint256 value, uint256 dl)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TH, payer, address(arc), value, arcUsdc.nonces(payer), dl));
        (v, r, s) = vm.sign(payerKey, keccak256(abi.encodePacked("\x19\x01", domainSep, structHash)));
    }

    function _arcSplit(bytes32 salt) internal returns (bytes32 id) {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = payer; ss[0] = 70e6;
        cs[1] = bob;   ss[1] = 30e6;
        vm.prank(creator);
        id = arc.createSplitPot(salt, recipient, GOAL, deadline, "arc", cs, ss);
    }

    // ── the domain itself ────────────────────────────────────────────────────

    function test_domainSeparator_equalsLiveArcTestnetUSDC() public view {
        assertEq(block.chainid, 5042002);
        assertEq(address(arcUsdc), 0x3600000000000000000000000000000000000000);
        assertEq(arcUsdc.DOMAIN_SEPARATOR(), LIVE_DOMAIN_SEPARATOR, "mock domain != live USDC domain");
    }

    function test_domainSeparator_fromFrontendFields() public pure {
        // name "USDC", version "2", chainId 5042002, verifyingContract = canonical USDC
        assertEq(_ds("USDC", "2", ARC_CHAIN_ID, ARC_USDC), LIVE_DOMAIN_SEPARATOR);
    }

    function test_domainSeparator_anyWrongFieldChangesIt() public pure {
        assertTrue(_ds("USD Coin", "2", ARC_CHAIN_ID, ARC_USDC) != LIVE_DOMAIN_SEPARATOR, "name");
        assertTrue(_ds("USDC", "1", ARC_CHAIN_ID, ARC_USDC) != LIVE_DOMAIN_SEPARATOR, "version");
        assertTrue(_ds("USDC", "2", 1, ARC_USDC) != LIVE_DOMAIN_SEPARATOR, "chainId");
        assertTrue(_ds("USDC", "2", ARC_CHAIN_ID, address(0x1234)) != LIVE_DOMAIN_SEPARATOR, "verifyingContract");
    }

    function test_domainSeparator_boundToChainAndAddress() public {
        assertTrue(pt.DOMAIN_SEPARATOR() != LIVE_DOMAIN_SEPARATOR, "non-canonical address must differ");
        vm.chainId(1);
        assertTrue(arcUsdc.DOMAIN_SEPARATOR() != LIVE_DOMAIN_SEPARATOR, "other chain must differ");
    }

    // ── funding with a permit signed under the live domain ────────────────────

    function test_fundWithPermit_signedWithLiveDomain() public {
        bytes32 id = _arcSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sigWithDomain(LIVE_DOMAIN_SEPARATOR, 70e6, PDL);
        assertEq(arcUsdc.allowance(payer, address(arc)), 0);

        vm.expectEmit(true, true, false, true, address(arc));
        emit Kitty.Funded(id, payer, 70e6, 70e6);
        vm.prank(payer);
        arc.fundWithPermit(id, 70e6, PDL, v, r, s);

        (, uint256 c,) = arc.getContribution(id, payer);
        assertEq(c, 70e6);
        assertEq(arcUsdc.balanceOf(address(arc)), 70e6);
        assertEq(arcUsdc.nonces(payer), 1);
        assertEq(arcUsdc.allowance(payer, address(arc)), 0);
        assertEq(arc.totalEscrowLiability(), 70e6);
    }

    function test_fundForWithPermit_signedWithLiveDomain() public {
        bytes32 id = _arcSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sigWithDomain(LIVE_DOMAIN_SEPARATOR, 30e6, PDL);
        vm.expectEmit(true, true, true, true, address(arc));
        emit Kitty.FundedFor(id, payer, bob, 30e6);
        vm.prank(payer);
        arc.fundForWithPermit(id, bob, 30e6, PDL, v, r, s);
        (, uint256 cb,) = arc.getContribution(id, bob);
        (, uint256 cp,) = arc.getContribution(id, payer);
        assertEq(cb, 30e6);
        assertEq(cp, 0);
    }

    function test_fullFlow_liveDomain_fundSettle() public {
        bytes32 id = _arcSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sigWithDomain(LIVE_DOMAIN_SEPARATOR, 70e6, PDL);
        vm.prank(payer);
        arc.fundWithPermit(id, 70e6, PDL, v, r, s);
        // second tap: payer pays bob's share through a second permit (nonce 1) under the same domain
        (v, r, s) = _sigWithDomain(LIVE_DOMAIN_SEPARATOR, 30e6, PDL);
        vm.prank(payer);
        arc.fundForWithPermit(id, bob, 30e6, PDL, v, r, s);
        assertEq(arcUsdc.nonces(payer), 2);
        arc.settle(id);
        assertEq(arcUsdc.balanceOf(recipient), GOAL);
        assertEq(arc.totalEscrowLiability(), 0);
    }

    function test_signatureUnderWrongDomain_isRejected_noAllowanceReverts() public {
        bytes32 id = _arcSplit(SALT_A);
        bytes32[4] memory wrong = [
            _ds("USD Coin", "2", ARC_CHAIN_ID, ARC_USDC),
            _ds("USDC", "1", ARC_CHAIN_ID, ARC_USDC),
            _ds("USDC", "2", 1, ARC_USDC),
            _ds("USDC", "2", ARC_CHAIN_ID, address(arc))
        ];
        for (uint256 i = 0; i < wrong.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = _sigWithDomain(wrong[i], 70e6, PDL);
            vm.prank(payer);
            vm.expectRevert(abi.encodeWithSelector(Kitty.InsufficientAllowanceAfterPermit.selector, 0, 70e6));
            arc.fundWithPermit(id, 70e6, PDL, v, r, s);
        }
        assertEq(arcUsdc.nonces(payer), 0);
    }
}
