// ─── Avatar identity: stable, distinct, accessible ──────────────────────────
import { describe, it, expect } from 'vitest';
import {
  AVATAR_PALETTE, NAMED_TINTS, addressAvatarProps, contrastRatio, hashString, initialsOf, isSameAddress, namedAvatar,
} from '../avatar';

const A = '0x1d2f6a8b3c4e5f60718293a4b5c6d7e8f9a0b1c2';
const B = '0x7a3b9c1d2e4f60718293a4b5c6d7e8f9a0b1c2d3';

describe('address avatars', () => {
  it('the same address always yields the same avatar props', () => {
    expect(addressAvatarProps(A, 24)).toEqual(addressAvatarProps(A, 24));
    expect(addressAvatarProps(A, 24)).toEqual(addressAvatarProps(`  ${A}  `, 24));
  });
  it('is case-insensitive: the seed is the lowercase address', () => {
    expect(addressAvatarProps(A.toUpperCase().replace('0X', '0x'), 32)).toEqual(addressAvatarProps(A, 32));
    expect(addressAvatarProps(A, 32).name).toBe(A);
  });
  it('two different addresses differ', () => {
    expect(addressAvatarProps(A, 24).name).not.toBe(addressAvatarProps(B, 24).name);
    expect(addressAvatarProps(A, 24)).not.toEqual(addressAvatarProps(B, 24));
  });
  it('uses marble and the one curated palette of five colours', () => {
    const p = addressAvatarProps(A, 24);
    expect(p.variant).toBe('marble');
    expect(p.colors).toEqual([...AVATAR_PALETTE]);
    expect(AVATAR_PALETTE).toHaveLength(5);
    for (const c of AVATAR_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('size only changes the size', () => {
    const { size: s24, ...r24 } = addressAvatarProps(A, 24);
    const { size: s40, ...r40 } = addressAvatarProps(A, 40);
    expect([s24, s40]).toEqual([24, 40]);
    expect(r24).toEqual(r40);
  });
});

describe('named avatars', () => {
  it('initials are 1 or 2 upper-case letters', () => {
    expect(initialsOf('Ana')).toBe('A');
    expect(initialsOf('You')).toBe('Y');
    expect(initialsOf('Mei Lin')).toBe('ML');
    expect(initialsOf("Lola's Bakery")).toBe('LB');
    expect(initialsOf('  ravi  ')).toBe('R');
    expect(initialsOf('')).toBe('?');
  });
  it('the tint is deterministic and font size is 40% of the avatar', () => {
    expect(namedAvatar('Ana', 32)).toEqual(namedAvatar('ana', 32));
    expect(namedAvatar('Ana', 40).fontSize).toBe(16);
    expect(namedAvatar('Ana', 24).fontSize).toBe(9.6);
  });
  it('different names can land on different tints', () => {
    const tints = new Set(['Ana', 'Ravi', 'Mei', 'Sam', 'You', 'Lola'].map(n => namedAvatar(n, 24).bg));
    expect(tints.size).toBeGreaterThan(1);
  });
  it('every tint has AA text contrast (4.5:1)', () => {
    for (const t of NAMED_TINTS) expect(contrastRatio(t.bg, t.fg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('helpers', () => {
  it('hashString is stable', () => {
    expect(hashString('a')).toBe(hashString('a'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
  it('isSameAddress ignores case and handles undefined', () => {
    expect(isSameAddress(A, A.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(isSameAddress(A, B)).toBe(false);
    expect(isSameAddress(A, undefined)).toBe(false);
  });
});
