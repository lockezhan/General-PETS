import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrokeRecognizer } from '../pet/natural/stroke-recognizer';
import { ActionDirector } from '../pet/natural/action-director';
import { AMBIENT_DELAY_RANGES, BehaviorPlanner } from '../pet/natural/behavior-planner';
import { DialogueDirector, getDialogueDurationMs } from '../pet/natural/dialogue-director';
import { DragPoseController } from '../pet/natural/drag-pose-controller';
import { PetVisualCoordinator } from '../pet/natural/visual-coordinator';
import { NaturalPointerSession } from '../pet/natural/natural-types';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import { CODEX_ACTION_PRESENTATION, getAmbientDialogueProbability } from '../pet/natural/action-presentation-profiles';

describe('Natural Interaction System (Phase 7.1 Reset)', () => {
  describe('Action presentation profiles', () => {
    it('defines stable interaction timing and ambient dialogue probabilities', () => {
      expect(CODEX_ACTION_PRESENTATION.waving).toMatchObject({ repeatCount: 2, minimumVisibleMs: 1600, holdAfterMs: 180 });
      expect(CODEX_ACTION_PRESENTATION.jumping).toMatchObject({ repeatCount: 2, minimumVisibleMs: 1800, holdAfterMs: 220 });
      expect(CODEX_ACTION_PRESENTATION.failed.minimumVisibleMs).toBe(1500);
      expect(CODEX_ACTION_PRESENTATION.review.minimumVisibleMs).toBe(1700);
      expect(getAmbientDialogueProbability('quiet', 'wave')).toBe(0.12);
      expect(getAmbientDialogueProbability('normal', 'review')).toBe(0.30);
      expect(getAmbientDialogueProbability('frequent', 'sit')).toBe(0.45);
      expect(getAmbientDialogueProbability('normal', 'hop')).toBeCloseTo(0.12);
    });
  });
  describe('PetVisualCoordinator', () => {
    it('should correctly prioritize motion state over reaction state', () => {
      const coordinator = new PetVisualCoordinator();

      coordinator.setReactionState('waving', 'user');
      expect(coordinator.resolveEffectiveAnimation().animation).toBe('waving');

      coordinator.setMotionState('falling');
      expect(coordinator.resolveEffectiveAnimation().animation).toBe('jumping');
      expect(coordinator.resolveEffectiveAnimation().source).toBe('physics');

      coordinator.setMotionState('drag-left');
      expect(coordinator.resolveEffectiveAnimation().animation).toBe('running-left');
      expect(coordinator.resolveEffectiveAnimation().source).toBe('drag');

      coordinator.clearMotionState('test');
      expect(coordinator.resolveEffectiveAnimation().animation).toBe('waving');
    });
  });

  describe('StrokeRecognizer', () => {
    let recognizer: StrokeRecognizer;
    let session: NaturalPointerSession;

    beforeEach(() => {
      recognizer = new StrokeRecognizer();
      session = {
        pointerId: 1,
        areaId: 'head',
        interactionRole: 'touch',
        acceptsStroke: true,
        draggable: false,
        startedAt: 1000,
        startX: 100,
        startY: 100,
        lastX: 100,
        lastY: 100,
        totalPathLength: 0,
        directDistance: 0,
        directionReversals: 0,
        lastAngle: null,
        averageSpeed: 100,
        maxSpeed: 100,
        strokeCommitted: false,
        pickupCommitted: false,
        longPressEligible: false,
        longPressCommitted: false,
        cancelled: false,
      };
    });

    it('should detect reciprocal stroke gesture with reversals', () => {
      let t = 1000;
      recognizer.updateMove(session, 110, 100, t += 50);
      recognizer.updateMove(session, 120, 100, t += 50);
      recognizer.updateMove(session, 105, 100, t += 50);
      recognizer.updateMove(session, 90, 100, t += 50);
      recognizer.updateMove(session, 115, 100, t += 50);

      expect(session.directionReversals).toBeGreaterThanOrEqual(2);
      expect(session.strokeCommitted).toBe(true);
    });

    it('should not detect stroke on a straight drag line', () => {
      let t = 1000;
      recognizer.updateMove(session, 120, 100, t += 50);
      recognizer.updateMove(session, 140, 100, t += 50);
      recognizer.updateMove(session, 160, 100, t += 50);

      expect(session.directionReversals).toBe(0);
      expect(session.strokeCommitted).toBe(false);
    });
  });

  describe('ActionDirector', () => {
    it('should enforce priority arbitration system > interaction > ambient', () => {
      const mockPlayer = {
        play: vi.fn(),
        stop: vi.fn(),
        getCurrentAnimation: () => 'idle',
        getPlaybackMode: () => 'clock' as const,
        beginDistanceDriven: vi.fn(),
        updateDistanceDriven: vi.fn(),
        endDistanceDriven: vi.fn(),
      };

      const director = new ActionDirector(mockPlayer as any);

      const ok1 = director.requestAction({
        id: 'a1',
        animation: 'idle',
        priority: 'ambient',
        source: 'behavior',
      });
      expect(ok1).toBe(true);

      const ok2 = director.requestAction({
        id: 'a2',
        animation: 'waving',
        priority: 'interaction',
        source: 'user',
      });
      expect(ok2).toBe(true);

      const ok3 = director.requestAction({
        id: 'a3',
        animation: 'waiting',
        priority: 'ambient',
        source: 'behavior',
      });
      expect(ok3).toBe(false);
    });

    it('must not retain a system-priority idle loop', () => {
      const mockPlayer = {
        play: vi.fn(),
        stop: vi.fn(),
        getCurrentAnimation: () => null,
        getPlaybackMode: () => 'clock' as const,
        beginDistanceDriven: vi.fn(),
        updateDistanceDriven: vi.fn(),
        endDistanceDriven: vi.fn(),
      };
      const director = new ActionDirector(mockPlayer as any);
      expect(director.requestAction({
        id: 'invalid-system-idle',
        animation: 'idle',
        priority: 'system',
        source: 'system',
        loop: true
      })).toBe(false);
      expect(director.getCurrentRequest()).toBeNull();
    });

    it('uses ambient priority for an action fallback', () => {
      let completion: ((state: string) => void) | undefined;
      const mockPlayer = {
        play: vi.fn((_name: string, options: any) => { completion = options.onComplete; }),
        stop: vi.fn(),
        getCurrentAnimation: () => null,
        getPlaybackMode: () => 'clock' as const,
        beginDistanceDriven: vi.fn(),
        updateDistanceDriven: vi.fn(),
        endDistanceDriven: vi.fn(),
      };
      const director = new ActionDirector(mockPlayer as any);
      expect(director.requestAction({
        id: 'interaction-wave', animation: 'waving', priority: 'interaction',
        source: 'user', fallback: 'idle', loop: false
      })).toBe(true);
      completion?.('idle');
      expect(director.getCurrentRequest()?.priority).toBe('ambient');
      expect(director.getCurrentRequest()?.animation).toBe('idle');
    });

    it('honors repeatCount, minimumVisibleMs and holdAfterMs under one token', () => {
      vi.useFakeTimers();
      const completions: Array<(state: string) => void> = [];
      const onComplete = vi.fn();
      const mockPlayer = {
        play: vi.fn((_name: string, options: any) => completions.push(options.onComplete)),
        stop: vi.fn(),
        getCurrentAnimation: () => null,
        getPlaybackMode: () => 'clock' as const,
        beginDistanceDriven: vi.fn(),
        updateDistanceDriven: vi.fn(),
        endDistanceDriven: vi.fn(),
      };
      const director = new ActionDirector(mockPlayer as any);

      director.requestAction({
        id: 'wave-twice', animation: 'waving', priority: 'interaction', source: 'user',
        loop: false, repeatCount: 2, minimumVisibleMs: 1600, holdAfterMs: 180, onComplete
      });
      const token = director.getActiveToken();
      completions[0]('idle');
      expect(mockPlayer.play).toHaveBeenCalledTimes(2);
      expect(director.getActiveToken()).toBe(token);

      vi.advanceTimersByTime(500);
      completions[1]('idle');
      vi.advanceTimersByTime(1279);
      expect(onComplete).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('ignores a stale completion callback after a newer action starts', () => {
      const completions: Array<(state: string) => void> = [];
      const firstComplete = vi.fn();
      const mockPlayer = {
        play: vi.fn((_name: string, options: any) => completions.push(options.onComplete)),
        stop: vi.fn(),
        getCurrentAnimation: () => null,
        getPlaybackMode: () => 'clock' as const,
        beginDistanceDriven: vi.fn(),
        updateDistanceDriven: vi.fn(),
        endDistanceDriven: vi.fn(),
      };
      const director = new ActionDirector(mockPlayer as any);
      director.requestAction({ id: 'first', animation: 'waving', priority: 'ambient', source: 'behavior', onComplete: firstComplete });
      director.requestAction({ id: 'second', animation: 'jumping', priority: 'interaction', source: 'user' });
      completions[0]('idle');
      expect(firstComplete).not.toHaveBeenCalled();
      expect(director.getCurrentRequest()?.id).toBe('second');
    });
  });

  describe('BehaviorPlanner', () => {
    it('should respect context and avoid walking immediately after user interaction', () => {
      const onPlanReady = vi.fn();
      const planner = new BehaviorPlanner(onPlanReady);

      planner.recordUserInteraction(performance.now());

      const context = {
        idleDurationMs: 1000,
        sinceLastUserInteractionMs: 1000,
        lastActionId: 'idle',
        recentActions: [],
        facing: 'right' as const,
        nearLeftEdge: false,
        nearRightEdge: false,
        currentHour: 12,
      };

      const plan = planner.planNextBehavior(DEFAULT_SETTINGS, context, ['walk', 'sit', 'wave', 'failed']);
      expect(plan.logicalAction).toBe('idle');
      expect(plan.logicalAction).not.toBe('failed');
    });

    it('uses the requested ambient frequency ranges', () => {
      vi.useFakeTimers();
      const timeoutSpy = vi.spyOn(window, 'setTimeout');
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const planner = new BehaviorPlanner(vi.fn());
      const context = {
        idleDurationMs: 0, sinceLastUserInteractionMs: Infinity, lastActionId: 'idle', recentActions: [],
        facing: 'right' as const, nearLeftEdge: false, nearRightEdge: false, currentHour: 12
      };

      for (const frequency of ['low', 'normal', 'high'] as const) {
        planner.scheduleNext({ ...DEFAULT_SETTINGS, ambientBehaviorFrequency: frequency }, context, ['idle']);
        const latestCall = timeoutSpy.mock.calls[timeoutSpy.mock.calls.length - 1];
        expect(latestCall?.[1]).toBe(AMBIENT_DELAY_RANGES[frequency].min);
      }
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('keeps a bounded action history and suppresses consecutive special repeats', () => {
      const planner = new BehaviorPlanner(vi.fn());
      for (const action of ['idle', 'walk', 'sit', 'review', 'wave', 'wave', 'wave']) {
        planner.recordActionStarted(action);
      }
      expect(planner.getHistory().recentActions).toHaveLength(6);
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const plan = planner.planNextBehavior(DEFAULT_SETTINGS, {
        idleDurationMs: 0, sinceLastUserInteractionMs: Infinity, lastActionId: 'wave', recentActions: [],
        facing: 'right', nearLeftEdge: false, nearRightEdge: false, currentHour: 12
      }, ['idle', 'walk', 'sit', 'wave', 'review', 'hop', 'run', 'fail']);
      expect(plan.logicalAction).not.toBe('wave');
      expect(plan.logicalAction).not.toBe('fail');
      vi.restoreAllMocks();
    });

    it('includes run in the ambient pool while excluding fail', () => {
      const planner = new BehaviorPlanner(vi.fn());
      vi.spyOn(Math, 'random').mockReturnValue(0.999);
      const plan = planner.planNextBehavior(DEFAULT_SETTINGS, {
        idleDurationMs: 0, sinceLastUserInteractionMs: Infinity, lastActionId: 'idle', recentActions: [],
        facing: 'right', nearLeftEdge: false, nearRightEdge: false, currentHour: 12
      }, ['idle', 'walk', 'sit', 'wave', 'review', 'hop', 'run', 'fail']);
      expect(plan.logicalAction).toBe('run');
      vi.restoreAllMocks();
    });
  });

  describe('DialogueDirector', () => {
    it('should compute dynamic dialogue duration based on text length', () => {
      const director = new DialogueDirector();
      const shouldShow = director.shouldShowDialogue('tap', DEFAULT_SETTINGS);
      expect(typeof shouldShow).toBe('boolean');

      const shortMs = getDialogueDurationMs('hi');
      const longMs = getDialogueDurationMs('This is a much longer dialogue for testing speech duration clamping.');

      expect(shortMs).toBeGreaterThanOrEqual(1800);
      expect(longMs).toBeLessThanOrEqual(4200);
      expect(longMs).toBeGreaterThan(shortMs);
    });

    it('allows the first valid dialogue immediately and applies event probabilities', () => {
      const director = new DialogueDirector();
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      expect(director.shouldShowDialogue('rapidTap', DEFAULT_SETTINGS, 0)).toBe(true);
      expect(director.shouldShowDialogue('tap', DEFAULT_SETTINGS, 1)).toBe(false);
      vi.restoreAllMocks();
    });
  });

  describe('DragPoseController', () => {
    it('should resolve pose based on velocity and direction', () => {
      const controller = new DragPoseController();

      const poseRight = controller.resolveDragPose(10, 'right');
      expect(poseRight).toBe('carried-right');

      const poseStatic = controller.resolveDragPose(0, null);
      expect(poseStatic).toBe('carried-static');
    });
  });
});
