import { describe, expect, it } from 'vitest';
import {
  enclosingSentence,
  guardsPass,
  inflictGuardFires,
  normaliseEffect,
  parseImmunitiesFromLines,
  parseSignedPercent,
} from '../src/immunity-text-parser.js';

describe('normaliseEffect', () => {
  it('accepts an exact vocabulary term', () => {
    expect(normaliseEffect('Bleed')).toBe('Bleed');
  });
  it('strips a leading article', () => {
    expect(normaliseEffect('an Incinerate')).toBe('Incinerate');
  });
  it('strips leading "all" quantifier', () => {
    expect(normaliseEffect('all Stun effects')).toBe('Stun');
  });
  it('strips trailing category nouns', () => {
    expect(normaliseEffect('Poison Debuffs')).toBe('Poison');
  });
  it('accepts the British spelling of Armor Break', () => {
    expect(normaliseEffect('Armour Break')).toBe('Armor Break');
  });
  it('rejects effects outside the tracked vocabulary', () => {
    expect(normaliseEffect('Fatigue')).toBeNull();
    expect(normaliseEffect('Precision')).toBeNull();
    expect(normaliseEffect('Rupture')).toBeNull();
  });
});

describe('parseSignedPercent', () => {
  it('handles a plain integer', () => {
    expect(parseSignedPercent('100')).toBe(100);
  });
  it('handles a decimal', () => {
    expect(parseSignedPercent('150.0')).toBe(150);
  });
  it('takes absolute value of a single-minus number', () => {
    expect(parseSignedPercent('-80')).toBe(80);
  });
  it('takes absolute value of a double-minus number (MCOC stat quirk)', () => {
    expect(parseSignedPercent('--100.0')).toBe(100);
  });
  it('returns null for non-numeric input', () => {
    expect(parseSignedPercent('none')).toBeNull();
  });
});

describe('enclosingSentence', () => {
  it('returns the whole line when there is no terminator', () => {
    const line = 'Champion becomes immune to Bleed';
    const idx = line.indexOf('immune');
    expect(enclosingSentence(line, idx)).toBe(line);
  });
  it('bounds by the previous sentence terminator', () => {
    const line = 'Something else. Champion becomes immune to Bleed.';
    const idx = line.indexOf('immune');
    expect(enclosingSentence(line, idx)).toBe(
      'Champion becomes immune to Bleed.',
    );
  });
});

describe('inflictGuardFires', () => {
  it('fires when the champion inflicts the effect', () => {
    expect(
      inflictGuardFires('Champion inflicts a Bleed Debuff', 'Bleed'),
    ).toBe(true);
  });
  it('fires when the champion places the effect', () => {
    expect(
      inflictGuardFires('Champion places a Poison lasting 10 seconds', 'Poison'),
    ).toBe(true);
  });
  it('does not fire when the effect appears without an inflicting verb', () => {
    expect(inflictGuardFires('Champion is immune to Bleed', 'Bleed')).toBe(false);
  });
});

describe('guardsPass — negation cases', () => {
  const negationCases: Array<[string, string]> = [
    ['no longer immune to Bleed', 'Bleed'],
    ['not immune to Poison', 'Poison'],
    ['loses her immunity to Stun', 'Stun'],
    ['cannot gain immunity to Incinerate', 'Incinerate'],
    ['does not gain Shock Immunity', 'Shock'],
    ['except when the opponent has a Stagger', 'Stagger'],
    ['unless the opponent is Bleeding', 'Bleed'],
    // The single most subtle false positive: "an Immunity" clause that
    // actually describes the OPPONENT's immunity blocking the champion's
    // Bleed debuff.
    ["If a Bleed fails to apply due to an Immunity, Carnage armor-breaks his opponent", 'Bleed'],
    ['prevented from gaining a Buff due to Fate Seal or Immunity', 'Bleed'],
  ];
  for (const [line, effect] of negationCases) {
    it(`rejects: "${line}"`, () => {
      // Placeholder match index — the guard only reads context, not the
      // match span. Give it a plausible spot inside the sentence.
      const idx = Math.max(0, line.toLowerCase().indexOf('immun'));
      expect(guardsPass(line, idx, effect as never)).toBe(false);
    });
  }
});

describe('guardsPass — clean cases', () => {
  it('passes a plain "immune to X" clause', () => {
    const line = 'The Hood becomes Immune to all Stun effects.';
    const idx = line.indexOf('Immune');
    expect(guardsPass(line, idx, 'Stun' as never)).toBe(true);
  });
  it('passes an "N% X Resistance" clause', () => {
    const line = 'Bastion has 100% Resistance against Bleed and Poison effects.';
    const idx = line.indexOf('Resistance');
    expect(guardsPass(line, idx, 'Bleed' as never)).toBe(true);
  });
});

describe('parseImmunitiesFromLines — end-to-end', () => {
  it('extracts "Immune to Shock" as immune', () => {
    const out = parseImmunitiesFromLines(['The Hood becomes Immune to all Stun effects.']);
    expect(out.Stun).toEqual({ band: 'immune' });
  });
  it("extracts Bastion's 100% resistance against Bleed and Poison", () => {
    const out = parseImmunitiesFromLines([
      'Bastion has 100% Resistance against Bleed and Poison effects.',
    ]);
    expect(out.Bleed).toEqual({ band: 'resist', qual: '100%' });
    expect(out.Poison).toEqual({ band: 'resist', qual: '100%' });
  });
  it("extracts Onslaught's 150% Bleed/Incinerate/Shock resist", () => {
    const out = parseImmunitiesFromLines([
      'Incoming Bleed, Incinerate, and Shock potency is reduced by -150.0%.',
    ]);
    expect(out.Bleed).toEqual({ band: 'resist', qual: '150%' });
    expect(out.Incinerate).toEqual({ band: 'resist', qual: '150%' });
    expect(out.Shock).toEqual({ band: 'resist', qual: '150%' });
  });
  it("extracts Silver Surfer's --100% damage-from cosmic staples", () => {
    const out = parseImmunitiesFromLines([
      'Silver Surfer takes --100.0% damage from Coldsnap, Incinerate, and Shock Debuffs.',
    ]);
    expect(out.Coldsnap).toEqual({ band: 'resist', qual: '100%' });
    expect(out.Incinerate).toEqual({ band: 'resist', qual: '100%' });
    expect(out.Shock).toEqual({ band: 'resist', qual: '100%' });
  });
  it('rejects "no longer immune to X" without emitting a lock', () => {
    const out = parseImmunitiesFromLines([
      'Champion becomes powerful but is no longer immune to Bleed for 10 seconds.',
    ]);
    expect(out.Bleed).toBeUndefined();
  });
  it('rejects the inflict pattern "inflicts a Bleed"', () => {
    const out = parseImmunitiesFromLines([
      'Champion inflicts a Bleed Debuff dealing 100 damage.',
    ]);
    expect(out.Bleed).toBeUndefined();
  });
  it('rejects the "fails to apply due to Immunity" false positive', () => {
    // The pattern that would otherwise catch Carnage as Bleed-immune.
    const out = parseImmunitiesFromLines([
      'If a Bleed fails to apply due to an Immunity, Carnage has a 100% chance to Armor Break his opponent.',
    ]);
    expect(out.Bleed).toBeUndefined();
  });
  it('promotes stronger bands per effect (immune > resist)', () => {
    const out = parseImmunitiesFromLines([
      'Champion has 80% Bleed Resistance.',
      'Champion becomes Immune to Bleed while Charged.',
    ]);
    expect(out.Bleed).toEqual({ band: 'immune' });
  });
  it('ignores out-of-vocabulary effects (Rupture, Frostbite, Fatigue)', () => {
    const out = parseImmunitiesFromLines([
      'Immune to Rupture and Frostbite.',
      '80% Fatigue Resistance.',
    ]);
    expect(Object.keys(out)).toEqual([]);
  });
});
