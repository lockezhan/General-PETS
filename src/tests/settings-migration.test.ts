import { describe, expect, it } from 'vitest';
import { migratePetSettings } from '../shared/settings-migration';

describe('migratePetSettings', () => {
  it('adds interactionEnabled=true when the saved field is missing', () => {
    const result = migratePetSettings({ schemaVersion: 5 });

    expect(result.settings.interactionEnabled).toBe(true);
    expect(result.interactionEnabledAdded).toBe(true);
  });

  it('preserves an explicit interactionEnabled=false value', () => {
    const result = migratePetSettings({
      schemaVersion: 5,
      interactionEnabled: false
    });

    expect(result.settings.interactionEnabled).toBe(false);
    expect(result.interactionEnabledAdded).toBe(false);
  });
});
