import { describe, it, expect, beforeEach } from 'vitest';
import { InteractionRuleEngine } from '../pet/interaction/interaction-rule-engine';
import { InteractionManifest } from '../pet/interaction/interaction-types';

describe('InteractionRuleEngine', () => {
  let engine: InteractionRuleEngine;

  beforeEach(() => {
    engine = new InteractionRuleEngine();
  });

  const sampleManifest: InteractionManifest = {
    schemaVersion: 1,
    hitAreas: [],
    rules: [
      {
        id: 'rule-single-head',
        event: 'singleClick',
        area: 'head',
        states: ['idle', 'walk'],
        priority: 10,
        actions: [{ type: 'playAnimation', animation: 'happy' }]
      },
      {
        id: 'rule-single-body',
        event: 'singleClick',
        area: 'body',
        priority: 20,
        actions: [{ type: 'showDialogue', group: 'patted' }]
      },
      {
        id: 'rule-double-head-high',
        event: 'doubleClick',
        area: 'head',
        priority: 100,
        weight: 50,
        actions: [{ type: 'playAnimation', animation: 'dizzy' }]
      },
      {
        id: 'rule-double-head-low',
        event: 'doubleClick',
        area: 'head',
        priority: 10,
        actions: [{ type: 'playAnimation', animation: 'happy' }]
      },
      {
        id: 'rule-cooldown-test',
        event: 'singleClick',
        area: 'body',
        priority: 30,
        cooldownMs: 1000,
        actions: [{ type: 'resetBehaviorTimer' }]
      }
    ]
  };

  it('should match rule based on event, area, and state', () => {
    // Matches rule-single-head (event='singleClick', area='head', state='idle')
    const rule = engine.matchRule('singleClick', 'head', 'idle', sampleManifest);
    expect(rule).toBeDefined();
    expect(rule?.id).toBe('rule-single-head');

    // Misses because state is not in allowed list ('sleep')
    const ruleMissState = engine.matchRule('singleClick', 'head', 'sleep', sampleManifest);
    expect(ruleMissState).toBeNull();

    // Misses because event doesn't match
    const ruleMissEvent = engine.matchRule('longPress', 'head', 'idle', sampleManifest);
    expect(ruleMissEvent).toBeNull();
  });

  it('should respect priority and match highest priority rule', () => {
    // Matches rule-double-head-high (priority=100) instead of rule-double-head-low (priority=10)
    const rule = engine.matchRule('doubleClick', 'head', 'idle', sampleManifest);
    expect(rule).toBeDefined();
    expect(rule?.id).toBe('rule-double-head-high');
  });

  it('should support weight-based random selection when priorities are equal', () => {
    const manifestWithEqualPri: InteractionManifest = {
      schemaVersion: 1,
      hitAreas: [],
      rules: [
        {
          id: 'rule-A',
          event: 'singleClick',
          area: 'head',
          priority: 10,
          weight: 80,
          actions: []
        },
        {
          id: 'rule-B',
          event: 'singleClick',
          area: 'head',
          priority: 10,
          weight: 20,
          actions: []
        }
      ]
    };

    const count = { A: 0, B: 0 };
    for (let i = 0; i < 1000; i++) {
      engine.clearCooldowns(); // avoid cooldown issue (though none is set)
      const rule = engine.matchRule('singleClick', 'head', 'idle', manifestWithEqualPri);
      if (rule?.id === 'rule-A') count.A++;
      if (rule?.id === 'rule-B') count.B++;
    }

    // Checking distribution (roughly 80% A, 20% B)
    expect(count.A).toBeGreaterThan(600);
    expect(count.B).toBeGreaterThan(100);
  });

  it('should respect cooldownMs and filter out rules currently in cooldown', () => {
    // First trigger
    const firstMatch = engine.matchRule('singleClick', 'body', 'idle', sampleManifest);
    expect(firstMatch?.id).toBe('rule-cooldown-test'); // cooldown of 1000ms begins

    // Second trigger immediately -> should be in cooldown, so fallback to rule-single-body (priority=20)
    const secondMatch = engine.matchRule('singleClick', 'body', 'idle', sampleManifest);
    expect(secondMatch?.id).toBe('rule-single-body');

    // Mock time passing by 1100ms
    const originalNow = performance.now;
    performance.now = () => originalNow.call(performance) + 1100;

    // Third trigger after cooldown -> should match rule-cooldown-test again
    const thirdMatch = engine.matchRule('singleClick', 'body', 'idle', sampleManifest);
    expect(thirdMatch?.id).toBe('rule-cooldown-test');

    // Restore performance.now
    performance.now = originalNow;
  });

  it('should clear cooldowns when requested (e.g. on character switch)', () => {
    const firstMatch = engine.matchRule('singleClick', 'body', 'idle', sampleManifest);
    expect(firstMatch?.id).toBe('rule-cooldown-test');

    engine.clearCooldowns();

    // After clearing, should match again immediately without waiting for cooldown
    const secondMatch = engine.matchRule('singleClick', 'body', 'idle', sampleManifest);
    expect(secondMatch?.id).toBe('rule-cooldown-test');
  });
});
