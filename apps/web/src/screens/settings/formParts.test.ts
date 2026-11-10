import { describe, expect, it } from 'vitest';
import { draftChanged } from './formParts';

describe('whether a policy form has changes', () => {
  it('does not count a list in a different order as a change', () => {
    expect(
      draftChanged({ blocked: ['b', 'a'], max: '1.2' }, { blocked: ['a', 'b'], max: '1.2' }),
    ).toBe(false);
  });

  it('counts a changed value or a changed list as a change', () => {
    expect(draftChanged({ blocked: ['a'], max: '1.5' }, { blocked: ['a'], max: '1.2' })).toBe(true);
    expect(draftChanged({ blocked: ['a', 'c'] }, { blocked: ['a', 'b'] })).toBe(true);
  });
});
