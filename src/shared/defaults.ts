import { PetSettings } from "./pet-settings";

export const DEFAULT_SETTINGS: PetSettings = {
  schemaVersion: 4,
  characterId: 'default',
  scale: 1,
  alwaysOnTop: true,
  randomDialogueEnabled: true,
  soundEnabled: true,
  sleepEnabled: true,
  sleepDelayMinutes: 5,
  autoMovementEnabled: true,
  walkSpeedMultiplier: 1,
  gravityEnabled: true,
  edgeBehavior: "turn",
  interactionEnabled: true,
  hitAreaDebugEnabled: false,
  animationSpeedMultiplier: 1.0
};
