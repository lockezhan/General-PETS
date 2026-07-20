import { CharacterSource } from '../codex/codex-types';

export type HorizontalDirection = "left" | "right";

export interface DirectionalAnimationResolution {
  animation: string;
  facing: HorizontalDirection;
  useFacingMirror: boolean;
}

/**
 * 将方向请求解析为动画名 + 朝向策略。
 *
 * Codex 角色：
 *   - 直接返回 walkLeft / walkRight（已是 CodexAtlasRenderer 的逻辑键）
 *   - useFacingMirror=false：renderer 内部使用独立的左右行，不需外层 CSS 镜像
 *
 * 内置角色：
 *   - 优先使用 walkLeft/walkRight 行；
 *   - 次选 walk + CSS 镜像；
 *   - 兜底 idle。
 */
export function resolveDirectionalAnimation(
  source: CharacterSource | null,
  direction: HorizontalDirection,
  hasAnimationFn: (name: string) => boolean
): DirectionalAnimationResolution {
  const isCodex = source && source.kind === 'installed';

  if (isCodex) {
    // Codex V1/V2：walkLeft/walkRight 是 CodexAtlasRenderer 的标准逻辑键。
    // renderer 内部映射：walkLeft → running-left → row 2；walkRight → running-right → row 1
    return {
      animation: direction === "left" ? "walkLeft" : "walkRight",
      facing: direction,
      useFacingMirror: false   // renderer 自有左右行，不需外层 CSS scaleX
    };
  }

  // 内置角色 A: 支持独立 walkLeft/walkRight
  if (hasAnimationFn("walkLeft") && hasAnimationFn("walkRight")) {
    return {
      animation: direction === "left" ? "walkLeft" : "walkRight",
      facing: direction,
      useFacingMirror: false
    };
  }

  // 内置角色 B: 单 walk + CSS 镜像
  if (hasAnimationFn("walk")) {
    return {
      animation: "walk",
      facing: direction,
      useFacingMirror: direction === "left"
    };
  }

  // 兜底
  return {
    animation: "idle",
    facing: direction,
    useFacingMirror: false
  };
}
