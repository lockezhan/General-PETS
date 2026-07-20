export interface PetSettings {
  schemaVersion: number;
  characterId: string;
  scale: number;
  alwaysOnTop: boolean;
  randomDialogueEnabled: boolean;
  soundEnabled: boolean;
  sleepEnabled: boolean;
  sleepDelayMinutes: number;

  autoMovementEnabled: boolean;
  walkSpeedMultiplier: number;
  gravityEnabled: boolean;
  edgeBehavior: "turn" | "stop";

  interactionEnabled: boolean;
  hitAreaDebugEnabled: boolean;
  animationSpeedMultiplier: number;
}
