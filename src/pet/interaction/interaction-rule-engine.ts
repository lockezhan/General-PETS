import { InteractionEventType, InteractionRule, InteractionManifest } from './interaction-types';

export class InteractionRuleEngine {
  private cooldownMap: Map<string, number> = new Map();

  public matchRule(
    event: InteractionEventType,
    areaId: string | null,
    currentState: string,
    manifest: InteractionManifest | null
  ): InteractionRule | null {
    if (!manifest || !manifest.rules) {
      return null;
    }

    const now = performance.now();

    // Filter rules
    const candidates = manifest.rules.filter(rule => {
      // Match event
      if (rule.event !== event) return false;

      // Match area
      if (rule.area !== "*" && rule.area !== areaId) return false;

      // Match current state if states filter is defined
      if (rule.states && rule.states.length > 0) {
        if (!rule.states.includes(currentState)) return false;
      }

      // Check cooldown
      const cooldownMs = rule.cooldownMs ?? 0;
      if (cooldownMs > 0 && this.cooldownMap.has(rule.id)) {
        const lastExecuted = this.cooldownMap.get(rule.id)!;
        if (now - lastExecuted < cooldownMs) {
          return false;
        }
      }

      return true;
    });

    if (candidates.length === 0) {
      return null;
    }

    // Sort by priority (default 0)
    let maxPriority = -Infinity;
    candidates.forEach(rule => {
      const p = rule.priority ?? 0;
      if (p > maxPriority) {
        maxPriority = p;
      }
    });

    const topPriorityCandidates = candidates.filter(rule => (rule.priority ?? 0) === maxPriority);

    // Weighted random selection
    const totalWeight = topPriorityCandidates.reduce((sum, rule) => sum + (rule.weight ?? 100), 0);
    if (totalWeight <= 0) {
      // Fallback to absolute first if weights are all 0
      const chosen = topPriorityCandidates[0];
      this.cooldownMap.set(chosen.id, now);
      return chosen;
    }

    let rolled = Math.random() * totalWeight;
    for (const rule of topPriorityCandidates) {
      const weight = rule.weight ?? 100;
      if (rolled <= weight) {
        this.cooldownMap.set(rule.id, now);
        return rule;
      }
      rolled -= weight;
    }

    const chosen = topPriorityCandidates[topPriorityCandidates.length - 1];
    this.cooldownMap.set(chosen.id, now);
    return chosen;
  }

  public clearCooldowns() {
    this.cooldownMap.clear();
  }
}
