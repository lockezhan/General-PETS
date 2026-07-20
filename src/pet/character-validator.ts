import { CharacterManifest } from '../shared/character-types';
import { InteractionManifest } from './interaction/interaction-types';

export function validateCharacterManifest(manifest: any): manifest is CharacterManifest {
  if (!manifest) {
    console.error("[Validator] Manifest is null or undefined");
    return false;
  }
  
  if (manifest.schemaVersion !== 1) {
    console.error("[Validator] Invalid schemaVersion, expected 1");
    return false;
  }
  
  if (!manifest.id || typeof manifest.id !== 'string') {
    console.error("[Validator] Invalid or missing id");
    return false;
  }
  
  if (!manifest.name || typeof manifest.name !== 'string') {
    console.error("[Validator] Invalid or missing name");
    return false;
  }
  
  if (!manifest.render || manifest.render.width <= 0 || manifest.render.height <= 0) {
    console.error("[Validator] render dimensions must be > 0");
    return false;
  }
  
  if (manifest.render.defaultScale <= 0) {
    console.error("[Validator] defaultScale must be > 0");
    return false;
  }
  
  if (manifest.render.anchorX < -10 || manifest.render.anchorX > 10 || manifest.render.anchorY < -10 || manifest.render.anchorY > 10) {
    console.error("[Validator] anchor values seem out of bounds");
    return false;
  }
  
  if (!manifest.animations || !manifest.animations.idle) {
    console.error("[Validator] animations.idle must exist");
    return false;
  }
  
  for (const [key, anim] of Object.entries(manifest.animations)) {
    const a = anim as any;
    if (!a.path || a.path.includes('..')) {
      console.error(`[Validator] Animation ${key} path is invalid (no .. allowed)`);
      return false;
    }
    if (a.fps <= 0) {
      console.error(`[Validator] Animation ${key} fps must be > 0`);
      return false;
    }
    if (!Array.isArray(a.frames) || a.frames.length === 0) {
      console.error(`[Validator] Animation ${key} must have at least one frame`);
      return false;
    }
    for (const frame of a.frames) {
      if (frame.includes('/') || frame.includes('\\')) {
        console.error(`[Validator] Animation ${key} frame name cannot be a path`);
        return false;
      }
    }
    if (a.fallback && a.fallback === key) {
      console.error(`[Validator] Animation ${key} fallback to itself creates a loop`);
      return false;
    }
  }
  
  if (manifest.motion) {
    const m = manifest.motion as any;
    if (m.walkSpeed !== undefined) {
      if (typeof m.walkSpeed !== 'number' || isNaN(m.walkSpeed) || !isFinite(m.walkSpeed) || m.walkSpeed <= 0 || m.walkSpeed > 1000) {
        console.error("[Validator] walkSpeed must be a valid number between 0 and 1000");
        return false;
      }
    }
    if (m.walkDurationMinMs !== undefined && m.walkDurationMaxMs !== undefined) {
      if (typeof m.walkDurationMinMs !== 'number' || typeof m.walkDurationMaxMs !== 'number' || 
          isNaN(m.walkDurationMinMs) || isNaN(m.walkDurationMaxMs) || 
          !isFinite(m.walkDurationMinMs) || !isFinite(m.walkDurationMaxMs)) {
        console.error("[Validator] walkDuration must be valid numbers");
        return false;
      }
      if (m.walkDurationMinMs > m.walkDurationMaxMs) {
        console.error("[Validator] walkDurationMinMs cannot be greater than walkDurationMaxMs");
        return false;
      }
    }
    if (m.idleDelayMinMs !== undefined && m.idleDelayMaxMs !== undefined) {
      if (typeof m.idleDelayMinMs !== 'number' || typeof m.idleDelayMaxMs !== 'number' || 
          isNaN(m.idleDelayMinMs) || isNaN(m.idleDelayMaxMs) || 
          !isFinite(m.idleDelayMinMs) || !isFinite(m.idleDelayMaxMs)) {
        console.error("[Validator] idleDelay must be valid numbers");
        return false;
      }
      if (m.idleDelayMinMs > m.idleDelayMaxMs) {
        console.error("[Validator] idleDelayMinMs cannot be greater than idleDelayMaxMs");
        return false;
      }
    }
  }

  return true;
}

function hasPrototypePollution(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  
  const proto = Object.getPrototypeOf(obj);
  if (Array.isArray(obj)) {
    if (proto !== Array.prototype) return true;
  } else {
    if (proto !== Object.prototype && proto !== null) return true;
  }

  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (hasPrototypePollution(obj[key])) {
      return true;
    }
  }
  return false;
}

// Check for scripts, eval, code execution keywords in string fields
function containsCodeInjection(str: string): boolean {
  const codePatterns = [
    /javascript:/i,
    /script/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /setTimeout\s*\(/i,
    /setInterval\s*\(/i,
    /window\./i,
    /document\./i,
    /process\./i,
    /require\s*\(/i
  ];
  return codePatterns.some(pattern => pattern.test(str));
}

export function validateInteractions(json: any): json is InteractionManifest {
  if (!json) {
    console.error("[Validator] Interactions config is null or undefined");
    return false;
  }

  if (hasPrototypePollution(json)) {
    console.error("[Validator] Prototype pollution detected in interactions JSON!");
    return false;
  }

  if (json.schemaVersion !== 1) {
    console.error("[Validator] Invalid interactions schemaVersion, expected 1");
    return false;
  }

  if (!Array.isArray(json.hitAreas)) {
    console.error("[Validator] hitAreas must be an array");
    return false;
  }

  const hitAreaIds = new Set<string>();

  for (const area of json.hitAreas) {
    if (!area || typeof area !== 'object') {
      console.error("[Validator] Invalid hitArea item");
      return false;
    }
    if (!area.id || typeof area.id !== 'string') {
      console.error("[Validator] hitArea.id must be a non-empty string");
      return false;
    }
    if (hitAreaIds.has(area.id)) {
      console.error(`[Validator] Duplicate hitArea id: ${area.id}`);
      return false;
    }
    hitAreaIds.add(area.id);

    if (area.name && typeof area.name !== 'string') {
      console.error(`[Validator] hitArea ${area.id} name must be a string`);
      return false;
    }

    if (area.priority !== undefined) {
      if (typeof area.priority !== 'number' || !isFinite(area.priority) || isNaN(area.priority)) {
        console.error(`[Validator] hitArea ${area.id} priority must be a finite number`);
        return false;
      }
    }

    if (area.draggable !== undefined && typeof area.draggable !== 'boolean') {
      console.error(`[Validator] hitArea ${area.id} draggable must be a boolean`);
      return false;
    }

    // Validate shapes
    if (area.shape === 'rect') {
      if (typeof area.x !== 'number' || typeof area.y !== 'number' || typeof area.width !== 'number' || typeof area.height !== 'number' ||
          !isFinite(area.x) || !isFinite(area.y) || !isFinite(area.width) || !isFinite(area.height)) {
        console.error(`[Validator] hitArea ${area.id} bounds must be finite numbers`);
        return false;
      }
      if (area.width <= 0 || area.height <= 0) {
        console.error(`[Validator] hitArea ${area.id} rect width and height must be > 0`);
        return false;
      }
    } else if (area.shape === 'ellipse') {
      if (typeof area.cx !== 'number' || typeof area.cy !== 'number' || typeof area.rx !== 'number' || typeof area.ry !== 'number' ||
          !isFinite(area.cx) || !isFinite(area.cy) || !isFinite(area.rx) || !isFinite(area.ry)) {
        console.error(`[Validator] hitArea ${area.id} center and radii must be finite numbers`);
        return false;
      }
      if (area.rx <= 0 || area.ry <= 0) {
        console.error(`[Validator] hitArea ${area.id} ellipse rx and ry must be > 0`);
        return false;
      }
    } else if (area.shape === 'polygon') {
      if (!Array.isArray(area.points) || area.points.length < 3) {
        console.error(`[Validator] hitArea ${area.id} polygon must have at least 3 points`);
        return false;
      }
      for (const p of area.points) {
        if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' ||
            !isFinite(p[0]) || !isFinite(p[1])) {
          console.error(`[Validator] hitArea ${area.id} polygon point must be array of 2 finite numbers`);
          return false;
        }
      }
    } else {
      console.error(`[Validator] hitArea ${area.id} has unknown shape: ${area.shape}`);
      return false;
    }
  }

  if (!Array.isArray(json.rules)) {
    console.error("[Validator] rules must be an array");
    return false;
  }

  const ruleIds = new Set<string>();
  const whitelistedEvents = ["singleClick", "doubleClick", "rapidClick", "longPress", "dragStart", "dragEnd"];
  const whitelistedActionTypes = ["playAnimation", "showDialogue", "resetBehaviorTimer", "cancelMotion", "setFacing"];

  for (const rule of json.rules) {
    if (!rule || typeof rule !== 'object') {
      console.error("[Validator] Invalid rule item");
      return false;
    }
    if (!rule.id || typeof rule.id !== 'string') {
      console.error("[Validator] rule.id must be a non-empty string");
      return false;
    }
    if (ruleIds.has(rule.id)) {
      console.error(`[Validator] Duplicate rule id: ${rule.id}`);
      return false;
    }
    ruleIds.add(rule.id);

    if (!whitelistedEvents.includes(rule.event)) {
      console.error(`[Validator] Rule ${rule.id} has invalid event: ${rule.event}`);
      return false;
    }

    if (typeof rule.area !== 'string') {
      console.error(`[Validator] Rule ${rule.id} area must be a string`);
      return false;
    }
    if (rule.area !== "*" && !hitAreaIds.has(rule.area)) {
      console.error(`[Validator] Rule ${rule.id} area "${rule.area}" does not exist in hitAreas`);
      return false;
    }

    if (rule.states !== undefined) {
      if (!Array.isArray(rule.states)) {
        console.error(`[Validator] Rule ${rule.id} states must be an array of strings`);
        return false;
      }
      for (const s of rule.states) {
        if (typeof s !== 'string') {
          console.error(`[Validator] Rule ${rule.id} state must be a string`);
          return false;
        }
      }
    }

    if (rule.priority !== undefined) {
      if (typeof rule.priority !== 'number' || !isFinite(rule.priority) || isNaN(rule.priority)) {
        console.error(`[Validator] Rule ${rule.id} priority must be a finite number`);
        return false;
      }
    }

    if (rule.weight !== undefined) {
      if (typeof rule.weight !== 'number' || !isFinite(rule.weight) || isNaN(rule.weight) || rule.weight < 0) {
        console.error(`[Validator] Rule ${rule.id} weight must be a non-negative finite number`);
        return false;
      }
    }

    if (rule.cooldownMs !== undefined) {
      if (typeof rule.cooldownMs !== 'number' || !isFinite(rule.cooldownMs) || isNaN(rule.cooldownMs) || rule.cooldownMs < 0) {
        console.error(`[Validator] Rule ${rule.id} cooldownMs must be a non-negative finite number`);
        return false;
      }
    }

    if (rule.exclusive !== undefined && typeof rule.exclusive !== 'boolean') {
      console.error(`[Validator] Rule ${rule.id} exclusive must be a boolean`);
      return false;
    }

    if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
      console.error(`[Validator] Rule ${rule.id} actions must be a non-empty array`);
      return false;
    }

    for (const action of rule.actions) {
      if (!action || typeof action !== 'object') {
        console.error(`[Validator] Rule ${rule.id} has invalid action`);
        return false;
      }
      if (!whitelistedActionTypes.includes(action.type)) {
        console.error(`[Validator] Rule ${rule.id} action has invalid type: ${action.type}`);
        return false;
      }

      if (action.type === 'playAnimation') {
        if (!action.animation || typeof action.animation !== 'string') {
          console.error(`[Validator] Rule ${rule.id} playAnimation action must specify animation string`);
          return false;
        }
        if (containsCodeInjection(action.animation)) {
          console.error(`[Validator] Code injection block in playAnimation animation name: ${action.animation}`);
          return false;
        }
        if (action.fallback && typeof action.fallback !== 'string') {
          console.error(`[Validator] Rule ${rule.id} playAnimation action fallback must be string`);
          return false;
        }
      } else if (action.type === 'showDialogue') {
        if (!action.group || typeof action.group !== 'string') {
          console.error(`[Validator] Rule ${rule.id} showDialogue action must specify group string`);
          return false;
        }
        if (containsCodeInjection(action.group)) {
          console.error(`[Validator] Code injection block in showDialogue group name: ${action.group}`);
          return false;
        }
      } else if (action.type === 'setFacing') {
        if (action.facing !== 'left' && action.facing !== 'right') {
          console.error(`[Validator] Rule ${rule.id} setFacing action facing must be "left" or "right"`);
          return false;
        }
      }
    }
  }

  // Validate fallback rules if present
  if (json.fallbackRules) {
    if (typeof json.fallbackRules !== 'object') {
      console.error("[Validator] fallbackRules must be an object");
      return false;
    }
    for (const [evt, fb] of Object.entries(json.fallbackRules)) {
      if (!whitelistedEvents.includes(evt)) {
        console.error(`[Validator] fallbackRules has invalid event: ${evt}`);
        return false;
      }
      const f = fb as any;
      if (f.animation && typeof f.animation !== 'string') {
        console.error(`[Validator] fallbackRules.${evt}.animation must be string`);
        return false;
      }
      if (f.animation && containsCodeInjection(f.animation)) {
        console.error(`[Validator] Code injection block in fallbackRules.${evt}.animation`);
        return false;
      }
      if (f.dialogueGroup && typeof f.dialogueGroup !== 'string') {
        console.error(`[Validator] fallbackRules.${evt}.dialogueGroup must be string`);
        return false;
      }
      if (f.dialogueGroup && containsCodeInjection(f.dialogueGroup)) {
        console.error(`[Validator] Code injection block in fallbackRules.${evt}.dialogueGroup`);
        return false;
      }
    }
  }

  return true;
}

export function validateDialogues(json: any): boolean {
  if (!json) {
    console.error("[Validator] Dialogues is null or undefined");
    return false;
  }
  if (json.schemaVersion !== 1) {
    console.error("[Validator] Invalid dialogues schemaVersion, expected 1");
    return false;
  }
  for (const [key, val] of Object.entries(json)) {
    if (key === 'schemaVersion') continue;
    if (!Array.isArray(val)) {
      console.error(`[Validator] Dialogue group "${key}" must be an array of strings`);
      return false;
    }
    for (let i = 0; i < val.length; i++) {
      const line = val[i];
      if (typeof line !== 'string') {
        console.error(`[Validator] Dialogue group "${key}" at index ${i} must be a string`);
        return false;
      }
      if (line.length > 40) {
        console.warn(`[Validator] Dialogue group "${key}" at index ${i} length is ${line.length}, which exceeds 40 characters limit.`);
      }
    }
  }
  return true;
}
