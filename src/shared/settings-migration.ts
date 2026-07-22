import { DEFAULT_SETTINGS } from './defaults';
import { PetSettings } from './pet-settings';

export interface PetSettingsMigrationResult {
  settings: PetSettings;
  interactionEnabledAdded: boolean;
}

export function migratePetSettings(
  savedSettings: Partial<PetSettings> | null | undefined
): PetSettingsMigrationResult {
  const interactionEnabledAdded =
    savedSettings != null &&
    typeof savedSettings.interactionEnabled !== 'boolean';

  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...(savedSettings ?? {}),
      interactionEnabled: interactionEnabledAdded
        ? true
        : savedSettings?.interactionEnabled ?? DEFAULT_SETTINGS.interactionEnabled
    },
    interactionEnabledAdded
  };
}
