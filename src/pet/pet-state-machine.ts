import { BuiltInPetState, PetState } from '../shared/character-types';

const STATE_PRIORITIES: Record<BuiltInPetState, number> = {
  dragged: 100,
  falling: 90,
  landing: 80,
  wake: 75,
  angry: 60,
  happy: 60,
  walk: 40,
  sit: 30,
  sleep: 20,
  idle: 10
};

export class PetStateMachine {
  private currentState: PetState = 'idle';

  public getState(): PetState {
    return this.currentState;
  }

  public canTransitionTo(newState: PetState): boolean {
    if (newState === 'idle') return true; // Idle is the default fallback, always allowed to transition back
    if (this.currentState === 'dragged' && (newState === 'falling' || newState === 'landing')) return true;
    if (this.currentState === 'falling' && newState === 'landing') return true;
    
    const currentPri = STATE_PRIORITIES[this.currentState as BuiltInPetState] !== undefined
      ? STATE_PRIORITIES[this.currentState as BuiltInPetState]
      : 60; // Default priority for custom reaction states is 60
      
    const newPri = STATE_PRIORITIES[newState as BuiltInPetState] !== undefined
      ? STATE_PRIORITIES[newState as BuiltInPetState]
      : 60; // Default priority for custom reaction states is 60
    
    return newPri >= currentPri;
  }

  public setState(newState: PetState): boolean {
    if (this.canTransitionTo(newState)) {
      this.currentState = newState;
      return true;
    }
    return false;
  }

  public forceState(newState: PetState) {
    this.currentState = newState;
  }
}
