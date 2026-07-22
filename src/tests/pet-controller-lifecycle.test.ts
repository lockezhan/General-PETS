import { describe, expect, it, vi } from 'vitest';
import { PetController } from '../pet/pet-controller';

describe('PetController free placement lifecycle', () => {
  it('keeps the ManualDragController final Y and returns directly to idle', async () => {
    const setPosition = vi.fn();
    const fake: any = {
      activeDragSessionId: 7,
      completedDragSessionId: 0,
      isDraggingWindow: true,
      dragWaitingTimer: null,
      clearDragWaitingTimer: vi.fn(),
      petRoot: { classList: { remove: vi.fn() } },
      floorController: { invalidateCache: vi.fn(), getCurrentFloorInfo: vi.fn() },
      manualDragController: {
        end: vi.fn().mockResolvedValue({
          startPhysicalX: 100,
          startPhysicalY: 400,
          endPhysicalX: 340,
          endPhysicalY: 300,
          totalLogicalX: 120,
          totalLogicalY: -50,
          maximumUpwardLiftLogical: 50,
          predominantlyVertical: false,
          moved: true
        })
      },
      player: { endDistanceDriven: vi.fn() },
      actionDirector: { clearCurrentAction: vi.fn() },
      visualCoordinator: { clearMotionState: vi.fn() },
      stateMachine: { forceState: vi.fn() },
      requestIdleVisual: vi.fn()
    };

    await (PetController.prototype as any).finishManualDrag.call(fake, 7, 'pointerup');

    expect(fake.manualDragController.end).toHaveBeenCalledWith('pointerup');
    expect(fake.floorController.getCurrentFloorInfo).not.toHaveBeenCalled();
    expect(setPosition).not.toHaveBeenCalled();
    expect(fake.actionDirector.clearCurrentAction).toHaveBeenCalledWith('manual drag ended');
    expect(fake.visualCoordinator.clearMotionState).toHaveBeenCalledWith('manual drag placed freely');
    expect(fake.stateMachine.forceState).toHaveBeenCalledWith('idle');
    expect(fake.requestIdleVisual).toHaveBeenCalledWith('manual drag placed freely');
  });

  it('completes landing through an explicit callback and then enters idle', () => {
    const fake: any = {
      player: { hasAnimation: vi.fn().mockReturnValue(true) },
      stateMachine: { forceState: vi.fn() },
      visualCoordinator: { setMotionState: vi.fn() },
      actionDirector: { clearCurrentAction: vi.fn(), requestAction: vi.fn() },
      requestIdleVisual: vi.fn()
    };

    (PetController.prototype as any).enterLandingAfterFall.call(fake);
    expect(fake.stateMachine.forceState).toHaveBeenCalledWith('landing');
    const request = fake.actionDirector.requestAction.mock.calls[0][0];
    expect(request.fallback).toBeUndefined();
    request.onComplete();
    expect(fake.requestIdleVisual).toHaveBeenCalledWith('landing completed');
  });
});
