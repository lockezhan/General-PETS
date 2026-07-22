import {
  CharacterCapabilities,
  CodexAdapterConfig,
  GeneralPetsExtrasConfig,
} from './codex-types';

export function resolveCharacterCapabilities(
  adapter: CodexAdapterConfig | null,
  extras: GeneralPetsExtrasConfig | null,
): CharacterCapabilities {
  if (adapter?.spriteVersionNumber === 2 && adapter.lookDirections) {
    return { supportsLookAround: true, lookAroundSource: 'codex-v2' };
  }
  if (extras?.animations.lookAround) {
    return { supportsLookAround: true, lookAroundSource: 'general-pets-extras' };
  }
  return { supportsLookAround: false, lookAroundSource: null };
}
