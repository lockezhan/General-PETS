import { afterEach, describe, expect, it, vi } from 'vitest';
import { PetController } from '../pet/pet-controller';

describe('PetController free placement lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
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

  it('defers a behavior plan instead of dropping it while non-idle', () => {
    const fake: any = {
      ambientSession: null,
      stateMachine: { getState: vi.fn().mockReturnValue('landing') },
      canStartAmbientBehavior: vi.fn().mockReturnValue(false),
      deferAmbientScheduling: vi.fn(),
      beginAmbientBehavior: vi.fn(),
    };
    (PetController.prototype as any).handleBehaviorPlan.call(fake, {
      id: 'blocked-plan', logicalAction: 'wave',
    });
    expect(fake.deferAmbientScheduling).toHaveBeenCalledOnce();
    expect(fake.beginAmbientBehavior).not.toHaveBeenCalled();
  });

  it('finishes an ambient session idempotently and starts exactly one next planner', () => {
    vi.useFakeTimers();
    const completionTimer = window.setTimeout(() => {}, 1000);
    const watchdogTimer = window.setTimeout(() => {}, 2000);
    const fake: any = {
      ambientSession: {
        id: 12,
        logicalAction: 'wave',
        animation: 'waving',
        startedAt: 0,
        status: 'playing',
        completionTimer,
        watchdogTimer,
      },
      behaviorPlanner: { recordActionCompleted: vi.fn() },
      visualCoordinator: { setReactionState: vi.fn() },
      enterIdleVisualWithoutScheduling: vi.fn(),
      startIdleTimers: vi.fn(),
    };
    const finish = (PetController.prototype as any).finishAmbientBehavior;
    finish.call(fake, 12, 'normal completion');
    finish.call(fake, 12, 'duplicate callback');

    expect(fake.behaviorPlanner.recordActionCompleted).toHaveBeenCalledTimes(1);
    expect(fake.enterIdleVisualWithoutScheduling).toHaveBeenCalledTimes(1);
    expect(fake.startIdleTimers).toHaveBeenCalledTimes(1);
    expect(fake.ambientSession).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the watchdog to recover when renderer completion never arrives', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake: any = {
      ambientSession: null,
      ambientSessionId: 0,
      ambientReschedulePending: false,
      cancelBehaviorPlanTimer: vi.fn(),
      cancelSleepTimer: vi.fn(),
      deferAmbientScheduling: vi.fn(),
      resolveAmbientAnimation: vi.fn().mockReturnValue('idle'),
      behaviorPlanner: {
        recordActionStarted: vi.fn(),
        recordActionCompleted: vi.fn(),
      },
      stateMachine: { getState: vi.fn().mockReturnValue('idle') },
      actionDirector: {
        getCurrentActionLabel: vi.fn().mockReturnValue('stuck-action'),
        clearCurrentAction: vi.fn(),
      },
      player: { getPlaybackMode: vi.fn().mockReturnValue('clock') },
      visualCoordinator: { setReactionState: vi.fn() },
      enterIdleVisualWithoutScheduling: vi.fn(),
      startAmbientSessionAction: vi.fn(),
      startIdleTimers: vi.fn(),
    };
    fake.finishAmbientBehavior = (...args: unknown[]) =>
      (PetController.prototype as any).finishAmbientBehavior.call(fake, ...args);
    fake.deferAmbientScheduling.mockImplementation(() => {
      fake.ambientReschedulePending = true;
    });

    (PetController.prototype as any).beginAmbientBehavior.call(fake, {
      id: 'stuck-idle', logicalAction: 'idle', durationMs: 5000,
    });
    vi.advanceTimersByTime(12000);

    expect(fake.actionDirector.clearCurrentAction).toHaveBeenCalledWith('ambient watchdog');
    expect(fake.behaviorPlanner.recordActionCompleted).toHaveBeenCalledWith('idle');
    expect(fake.enterIdleVisualWithoutScheduling).toHaveBeenCalledWith('watchdog timeout');
    expect(fake.startIdleTimers).toHaveBeenCalledOnce();
    expect(fake.ambientSession).toBeNull();
  });

  it('recovers a timed loop when its normal completion timer is cancelled', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake: any = {
      ambientSession: null,
      ambientSessionId: 0,
      ambientReschedulePending: false,
      cancelBehaviorPlanTimer: vi.fn(),
      cancelSleepTimer: vi.fn(),
      resolveAmbientAnimation: vi.fn().mockReturnValue('idle'),
      canStartAmbientBehavior: vi.fn().mockReturnValue(true),
      behaviorPlanner: {
        recordActionStarted: vi.fn(),
        recordActionCompleted: vi.fn(),
      },
      stateMachine: { getState: vi.fn().mockReturnValue('idle') },
      actionDirector: {
        getCurrentActionLabel: vi.fn().mockReturnValue('timed-idle'),
        clearCurrentAction: vi.fn(),
        requestAction: vi.fn().mockReturnValue(true),
      },
      player: { getPlaybackMode: vi.fn().mockReturnValue('clock') },
      visualCoordinator: { setReactionState: vi.fn() },
      enterIdleVisualWithoutScheduling: vi.fn(),
      tryShowAmbientDialogue: vi.fn(),
      startIdleTimers: vi.fn(),
    };
    fake.finishAmbientBehavior = (...args: unknown[]) =>
      (PetController.prototype as any).finishAmbientBehavior.call(fake, ...args);
    fake.startAmbientSessionAction = (...args: unknown[]) =>
      (PetController.prototype as any).startAmbientSessionAction.call(fake, ...args);
    fake.beginAmbientSettle = (...args: unknown[]) =>
      (PetController.prototype as any).beginAmbientSettle.call(fake, ...args);

    (PetController.prototype as any).beginAmbientBehavior.call(fake, {
      id: 'timed-loop', logicalAction: 'idle', durationMs: 5000,
    });
    vi.advanceTimersByTime(150);
    expect(fake.ambientSession.status).toBe('playing');
    clearTimeout(fake.ambientSession.completionTimer);
    vi.advanceTimersByTime(11850);

    expect(fake.actionDirector.clearCurrentAction).toHaveBeenCalledWith('ambient watchdog');
    expect(fake.startIdleTimers).toHaveBeenCalledOnce();
    expect(fake.ambientSession).toBeNull();
  });

  it('cancels an ambient session for user interaction and leaves one pending reschedule', () => {
    vi.useFakeTimers();
    const fake: any = {
      ambientSession: {
        id: 4,
        logicalAction: 'review',
        animation: 'review',
        startedAt: 0,
        status: 'playing',
        completionTimer: window.setTimeout(() => {}, 1000),
        watchdogTimer: window.setTimeout(() => {}, 6500),
      },
      ambientReschedulePending: false,
      cancelBehaviorPlanTimer: vi.fn(),
      cancelSleepTimer: vi.fn(),
      deferAmbientScheduling: vi.fn(),
      behaviorPlanner: { recordActionCompleted: vi.fn() },
      visualCoordinator: { setReactionState: vi.fn() },
      enterIdleVisualWithoutScheduling: vi.fn(),
      startIdleTimers: vi.fn(),
    };
    fake.finishAmbientBehavior = (...args: unknown[]) =>
      (PetController.prototype as any).finishAmbientBehavior.call(fake, ...args);
    fake.deferAmbientScheduling.mockImplementation(() => {
      fake.ambientReschedulePending = true;
    });

    (PetController.prototype as any).cancelAmbientBehavior.call(fake, 'user animation request');
    expect(fake.ambientSession).toBeNull();
    expect(fake.ambientReschedulePending).toBe(true);
    expect(fake.enterIdleVisualWithoutScheduling).not.toHaveBeenCalled();
    expect(fake.startIdleTimers).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels every ambient timer while hidden and restores idle scheduling when shown', () => {
    const fake: any = {
      windowVisible: true,
      ambientReschedulePending: false,
      motionController: { cancelActiveMotion: vi.fn() },
      cancelAllForShutdown: vi.fn(),
      floorController: { invalidateCache: vi.fn() },
      stateMachine: { getState: vi.fn().mockReturnValue('idle') },
      isDraggingWindow: false,
      requestIdleVisual: vi.fn(),
      deferAmbientScheduling: vi.fn(),
    };
    const visibility = (PetController.prototype as any).handleWindowVisibilityChanged;
    visibility.call(fake, false);
    expect(fake.windowVisible).toBe(false);
    expect(fake.cancelAllForShutdown).toHaveBeenCalledWith('window hidden');
    expect(fake.ambientReschedulePending).toBe(true);

    visibility.call(fake, true);
    expect(fake.windowVisible).toBe(true);
    expect(fake.requestIdleVisual).toHaveBeenCalledWith('window shown');
  });

  it('routes a verified look path to settle without dialogue or window motion', () => {
    const onPath = vi.fn().mockReturnValue(true);
    const fake: any = {
      loader: {
        getCapabilities: vi.fn().mockReturnValue({
          supportsLookAround: true,
          lookAroundSource: 'codex-v2',
        }),
        getAdapterConfig: vi.fn().mockReturnValue({
          lookDirections: {
            center: { row: 0, column: 4 }, up: { row: 9, column: 0 },
            upperRight: { row: 9, column: 2 }, right: { row: 9, column: 4 },
            lowerRight: { row: 9, column: 6 }, down: { row: 10, column: 0 },
            lowerLeft: { row: 10, column: 2 }, left: { row: 10, column: 4 },
            upperLeft: { row: 10, column: 6 },
          },
        }),
      },
      player: { playFramePath: onPath },
      actionDirector: { clearCurrentAction: vi.fn() },
      visualCoordinator: { setReactionState: vi.fn() },
      beginAmbientSettle: vi.fn(),
    };
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect((PetController.prototype as any).playLookAround.call(fake, 19)).toBe(true);
    const request = onPath.mock.calls[0][0];
    expect(request.frames.map((frame: any) => [frame.row, frame.column])).toEqual([
      [0, 4], [10, 6], [10, 4], [10, 6], [0, 4],
    ]);
    request.onComplete();
    expect(fake.beginAmbientSettle).toHaveBeenCalledWith(19, 'look around completed');
  });
});
