import { describe, it, expect } from 'vitest';
import { validateInteractions, validateDialogues } from '../pet/character-validator';

describe('validateInteractions', () => {
  const validInteractions = {
    schemaVersion: 1,
    hitAreas: [
      {
        id: 'head',
        name: '头部',
        shape: 'ellipse',
        cx: 0.5,
        cy: 0.3,
        rx: 0.2,
        ry: 0.2,
        priority: 10,
        draggable: true
      },
      {
        id: 'body',
        name: '身体',
        shape: 'rect',
        x: 0.2,
        y: 0.5,
        width: 0.6,
        height: 0.4,
        priority: 5,
        draggable: true
      }
    ],
    rules: [
      {
        id: 'head-click',
        event: 'singleClick',
        area: 'head',
        states: ['idle'],
        priority: 20,
        weight: 100,
        cooldownMs: 2000,
        exclusive: true,
        actions: [
          {
            type: 'playAnimation',
            animation: 'happy',
            fallback: 'idle'
          }
        ]
      }
    ]
  };

  it('should validate correct interactions config', () => {
    expect(validateInteractions(validInteractions)).toBe(true);
  });

  it('should reject invalid schemaVersion', () => {
    const invalid = { ...validInteractions, schemaVersion: 2 };
    expect(validateInteractions(invalid)).toBe(false);
  });

  it('should reject duplicate hitArea IDs', () => {
    const invalid = {
      ...validInteractions,
      hitAreas: [
        { id: 'head', shape: 'rect', x: 0, y: 0, width: 0.5, height: 0.5 },
        { id: 'head', shape: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
      ]
    };
    expect(validateInteractions(invalid)).toBe(false);
  });

  it('should reject ellipse with zero or negative rx/ry', () => {
    const invalid = {
      ...validInteractions,
      hitAreas: [
        { id: 'head', shape: 'ellipse', cx: 0.5, cy: 0.3, rx: 0, ry: 0.2 }
      ]
    };
    expect(validateInteractions(invalid)).toBe(false);
  });

  it('should reject polygon with less than 3 points', () => {
    const invalid = {
      ...validInteractions,
      hitAreas: [
        { id: 'feet', shape: 'polygon', points: [[0.1, 0.1], [0.2, 0.2]] }
      ]
    };
    expect(validateInteractions(invalid)).toBe(false);
  });

  it('should detect prototype pollution and reject it', () => {
    // Standard pollution check
    const polluluted = JSON.parse(JSON.stringify(validInteractions));
    polluluted.hitAreas[0].__proto__ = { polluted: true };
    
    // Test direct object properties
    const directPollution = {
      ...validInteractions,
      "__proto__": { polluted: true }
    };
    expect(validateInteractions(directPollution)).toBe(false);
  });

  it('should reject code injection attempts in string fields', () => {
    const codeInjection = {
      ...validInteractions,
      rules: [
        {
          id: 'hack-click',
          event: 'singleClick',
          area: 'head',
          actions: [
            {
              type: 'playAnimation',
              animation: 'happy; eval("alert(1)")',
              fallback: 'idle'
            }
          ]
        }
      ]
    };
    expect(validateInteractions(codeInjection)).toBe(false);
  });

  it('should reject invalid action types', () => {
    const invalidAction = {
      ...validInteractions,
      rules: [
        {
          id: 'bad-rule',
          event: 'singleClick',
          area: 'head',
          actions: [
            {
              type: 'deleteSystemFiles', // unknown type
              animation: 'happy'
            }
          ]
        }
      ]
    };
    expect(validateInteractions(invalidAction)).toBe(false);
  });
});

describe('validateDialogues', () => {
  it('should validate a correct dialogues structure', () => {
    const valid = {
      schemaVersion: 1,
      idle: ["hello", "world"],
      click: ["ouch!"]
    };
    expect(validateDialogues(valid)).toBe(true);
  });

  it('should reject invalid schemaVersion', () => {
    const invalid = {
      schemaVersion: 2,
      idle: ["hello"]
    };
    expect(validateDialogues(invalid)).toBe(false);
  });

  it('should reject non-array dialogue groups', () => {
    const invalid = {
      schemaVersion: 1,
      idle: "hello"
    };
    expect(validateDialogues(invalid)).toBe(false);
  });

  it('should warn/permit but validate length over 40 characters without failing', () => {
    const longDialogue = {
      schemaVersion: 1,
      idle: ["This dialogue is extremely long and will definitely exceed forty characters limit for testing!"]
    };
    // Should still return true (just console.warn)
    expect(validateDialogues(longDialogue)).toBe(true);
  });
});
