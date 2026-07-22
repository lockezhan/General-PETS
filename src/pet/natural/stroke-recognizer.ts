import { NaturalPointerSession } from './natural-types';

export const STROKE_MIN_PATH_PX = 28;
export const STROKE_MIN_REVERSALS = 2;
export const STROKE_MIN_DURATION_MS = 220;
export const STROKE_MAX_AVERAGE_SPEED = 900;
export const STROKE_DIRECTION_CHANGE_DEG = 110;

export class StrokeRecognizer {
  public updateMove(session: NaturalPointerSession, currentX: number, currentY: number, now: number) {
    if (session.cancelled || !session.acceptsStroke) return;

    const dx = currentX - session.lastX;
    const dy = currentY - session.lastY;
    const stepDist = Math.hypot(dx, dy);

    if (stepDist < 2) return; // 忽略微小抖动

    session.totalPathLength += stepDist;
    session.directDistance = Math.hypot(currentX - session.startX, currentY - session.startY);

    const elapsed = (now - session.startedAt) / 1000;
    session.averageSpeed = elapsed > 0 ? session.totalPathLength / elapsed : 0;
    const instantaneousSpeed = stepDist / 0.016; // approx
    if (instantaneousSpeed > session.maxSpeed) {
      session.maxSpeed = instantaneousSpeed;
    }

    // 方向角度计算与反转识别
    const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (session.lastAngle !== null) {
      let angleDiff = Math.abs(currentAngle - session.lastAngle);
      if (angleDiff > 180) angleDiff = 360 - angleDiff;

      if (angleDiff >= STROKE_DIRECTION_CHANGE_DEG) {
        session.directionReversals++;
      }
    }
    session.lastAngle = currentAngle;
    session.lastX = currentX;
    session.lastY = currentY;

    if (this.checkStrokeCondition(session, now)) {
      session.strokeCommitted = true;
    }
  }

  public checkStrokeCondition(session: NaturalPointerSession, now: number): boolean {
    if (!session.acceptsStroke || session.cancelled || session.pickupCommitted) {
      return false;
    }

    const elapsedMs = now - session.startedAt;

    const pathOk = session.totalPathLength >= STROKE_MIN_PATH_PX;
    const reversalsOk = session.directionReversals >= STROKE_MIN_REVERSALS;
    const durationOk = elapsedMs >= STROKE_MIN_DURATION_MS;
    const speedOk = session.averageSpeed <= STROKE_MAX_AVERAGE_SPEED;

    // 往复位移轨迹必须大于直线距离，确保不是一笔直线拉拽
    const nonStraightOk = session.totalPathLength > session.directDistance * 1.35;

    return pathOk && reversalsOk && durationOk && speedOk && nonStraightOk;
  }
}
