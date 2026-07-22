import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrokeRecognizer } from '../pet/natural/stroke-recognizer';
import { ReactionSession } from '../pet/natural/reaction-session';
import { ActionDirector } from '../pet/natural/action-director';
import { BehaviorPlanner } from '../pet/natural/behavior-planner';
import { DialogueDirector, getDialogueDurationMs } from '../pet/natural/dialogue-director';
import { DragPoseController } from '../pet/natural/drag-pose-controller';
import { NaturalPointerSession } from '../pet/natural/natural-types';
import { DEFAULT_SETTINGS } from '../shared/defaults';

describe('Natural Interaction System (Phase 7)', () => {
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
      // Simulate left-right-left movement
      let t = 1000;
      recognizer.updateMove(session, 110, 100, t += 50); // right
      recognizer.updateMove(session, 120, 100, t += 50); // right
      recognizer.updateMove(session, 105, 100, t += 50); // left (reversal 1)
      recognizer.updateMove(session, 90, 100, t += 50);  // left
      recognizer.updateMove(session, 115, 100, t += 50); // right (reversal 2)

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

  describe('ReactionSession', () => {
    it('should initialize and support extend without restarting', () => {
      const rs = new ReactionSession('touch-head', 1000);
      expect(rs.active).toBe(true);

      const extended = rs.extend(1200);
      expect(extended).toBe(true);
      expect(rs.lastExtendedAt).toBe(1200);
    });

    it('should end naturally when exceeding max duration', () => {
      const rs = new ReactionSession('touch-head', 1000);
      const extended = rs.extend(1000 + 8500); // > 8000ms

      expect(extended).toBe(false);
      expect(rs.active).toBe(false);
      expect(rs.finishedReason).toBe('max-duration-reached');
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

      // 1. Ambient request
      const ok1 = director.requestAction({
        id: 'a1',
        animation: 'idle',
        priority: 'ambient',
        source: 'behavior',
      });
      expect(ok1).toBe(true);

      // 2. Interaction request overrides ambient
      const ok2 = director.requestAction({
        id: 'a2',
        animation: 'happy',
        priority: 'interaction',
        source: 'user',
      });
      expect(ok2).toBe(true);

      // 3. Ambient request CANNOT override active interaction
      const ok3 = director.requestAction({
        id: 'a3',
        animation: 'sit',
        priority: 'ambient',
        source: 'behavior',
      });
      expect(ok3).toBe(false);
    });
  });

  describe('BehaviorPlanner', () => {
    it('should respect context and avoid walking immediately after user interaction', () => {
      const onPlanReady = vi.fn();
      const planner = new BehaviorPlanner(onPlanReady);

      planner.recordUserInteraction(performance.now());

      const context = {
        idleDurationMs: 1000,
        sinceLastUserInteractionMs: 1000, // < 5000ms
        lastActionId: 'idle',
        recentActions: [],
        facing: 'right' as const,
        nearLeftEdge: false,
        nearRightEdge: false,
        currentHour: 12,
      };

      const plan = planner.planNextBehavior(DEFAULT_SETTINGS, context, ['walk', 'sit', 'wave']);
      expect(['idle', 'wave']).toContain(plan.logicalAction);
      expect(plan.logicalAction).not.toBe('walk');
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
  });

  describe('DragPoseController', () => {
    it('should resolve pose based on velocity and direction', () => {
      const controller = new DragPoseController();

      // High horizontal velocity right
      const poseRight = controller.resolveDragPose(10, 0, 100, 0);
      expect(poseRight).toBe('carried-right');

      // High vertical velocity
      const poseVert = controller.resolveDragPose(0, 10, 0, 150);
      expect(poseVert).toBe('carried-vertical');
    });
  });
});
