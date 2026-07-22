import { InteractionStyle } from '../pet/natural/natural-types';

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

  naturalInteractionEnabled: boolean;
  hoverPettingEnabled: boolean;
  dialogueFrequency: "quiet" | "normal" | "frequent";
  ambientBehaviorFrequency: "low" | "normal" | "high";
  interactionStyle: InteractionStyle;
}
