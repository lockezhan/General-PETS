import { load } from '@tauri-apps/plugin-store';
import { emitTo } from '@tauri-apps/api/event';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

import { PetSettings } from '../shared/pet-settings';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import { EVENT_SETTINGS_CHANGED, EVENT_RESET_POSITION, EVENT_TEST_WALK, EVENT_TEST_FALL } from '../shared/event-names';
import { InstalledCharacter, CodexScanResult } from '../pet/codex/codex-types';

export class SettingsController {
  private store: any;
  private settings: PetSettings = { ...DEFAULT_SETTINGS };

  // General tab elements
  private scaleInput!: HTMLInputElement;
  private scaleValue!: HTMLSpanElement;
  private alwaysOnTopCheck!: HTMLInputElement;
  private randomDialogueCheck!: HTMLInputElement;
  private sleepEnabledCheck!: HTMLInputElement;
  private sleepDelayInput!: HTMLInputElement;
  private btnReset!: HTMLButtonElement;
  private btnResetPosition!: HTMLButtonElement;
  
  private autoMovementEnabledCheck!: HTMLInputElement;
  private walkSpeedMultiplierInput!: HTMLInputElement;
  private walkSpeedMultiplierValue!: HTMLSpanElement;
  private gravityEnabledCheck!: HTMLInputElement;
  private edgeBehaviorSelect!: HTMLSelectElement;
  private btnTestWalkLeft!: HTMLButtonElement;
  private btnTestWalkRight!: HTMLButtonElement;
  private btnTestFall!: HTMLButtonElement;

  private interactionEnabledCheck!: HTMLInputElement;
  private hitAreaDebugEnabledCheck!: HTMLInputElement;
  private animationSpeedMultiplierInput!: HTMLInputElement;
  private animationSpeedMultiplierValue!: HTMLSpanElement;

  // Tabs elements
  private tabButtons!: NodeListOf<HTMLButtonElement>;
  private tabContents!: NodeListOf<HTMLDivElement>;

  // Character manager elements
  private currentPreviewBox!: HTMLDivElement;
  private currentTitleEl!: HTMLDivElement;
  private currentDescEl!: HTMLDivElement;
  private currentSourceEl!: HTMLSpanElement;
  private installedListEl!: HTMLDivElement;
  private btnSelectImportDir!: HTMLButtonElement;
  private btnScanCodex!: HTMLButtonElement;
  private scanResultsContainer!: HTMLDivElement;
  private scanResultsListEl!: HTMLDivElement;
  private btnImportAllValid!: HTMLButtonElement;

  private scanResults: CodexScanResult[] = [];

  async init() {
    document.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
    });

    // Initialize UI element bindings
    this.scaleInput = document.getElementById('scale') as HTMLInputElement;
    this.scaleValue = document.getElementById('scale-value') as HTMLSpanElement;
    this.alwaysOnTopCheck = document.getElementById('alwaysOnTop') as HTMLInputElement;
    this.randomDialogueCheck = document.getElementById('randomDialogueEnabled') as HTMLInputElement;
    this.sleepEnabledCheck = document.getElementById('sleepEnabled') as HTMLInputElement;
    this.sleepDelayInput = document.getElementById('sleepDelayMinutes') as HTMLInputElement;
    this.btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
    this.btnResetPosition = document.getElementById('btn-reset-position') as HTMLButtonElement;
    this.autoMovementEnabledCheck = document.getElementById('autoMovementEnabled') as HTMLInputElement;
    this.walkSpeedMultiplierInput = document.getElementById('walkSpeedMultiplier') as HTMLInputElement;
    this.walkSpeedMultiplierValue = document.getElementById('walkSpeedMultiplier-value') as HTMLSpanElement;
    this.gravityEnabledCheck = document.getElementById('gravityEnabled') as HTMLInputElement;
    this.edgeBehaviorSelect = document.getElementById('edgeBehavior') as HTMLSelectElement;
    this.btnTestWalkLeft = document.getElementById('btn-test-walk-left') as HTMLButtonElement;
    this.btnTestWalkRight = document.getElementById('btn-test-walk-right') as HTMLButtonElement;
    this.btnTestFall = document.getElementById('btn-test-fall') as HTMLButtonElement;
    this.interactionEnabledCheck = document.getElementById('interactionEnabled') as HTMLInputElement;
    this.hitAreaDebugEnabledCheck = document.getElementById('hitAreaDebugEnabled') as HTMLInputElement;
    this.animationSpeedMultiplierInput = document.getElementById('animationSpeedMultiplier') as HTMLInputElement;
    this.animationSpeedMultiplierValue = document.getElementById('animationSpeedMultiplier-value') as HTMLSpanElement;

    // Tabs
    this.tabButtons = document.querySelectorAll('.tab-btn');
    this.tabContents = document.querySelectorAll('.tab-content');

    // Character manager bindings
    this.currentPreviewBox = document.getElementById('current-char-preview') as HTMLDivElement;
    this.currentTitleEl = document.getElementById('current-char-title') as HTMLDivElement;
    this.currentDescEl = document.getElementById('current-char-desc') as HTMLDivElement;
    this.currentSourceEl = document.getElementById('current-char-source') as HTMLSpanElement;
    this.installedListEl = document.getElementById('installed-characters-list') as HTMLDivElement;
    this.btnSelectImportDir = document.getElementById('btn-select-import-dir') as HTMLButtonElement;
    this.btnScanCodex = document.getElementById('btn-scan-codex') as HTMLButtonElement;
    this.scanResultsContainer = document.getElementById('scan-results-container') as HTMLDivElement;
    this.scanResultsListEl = document.getElementById('scan-results-list') as HTMLDivElement;
    this.btnImportAllValid = document.getElementById('btn-import-all-valid') as HTMLButtonElement;

    try {
      this.store = await load('settings.json', { autoSave: true });
      const saved = await this.store.get('pet-settings');
      if (saved) {
        const savedSettings = saved as any;
        if (savedSettings.schemaVersion === 1) {
          this.settings = {
            ...DEFAULT_SETTINGS,
            ...savedSettings,
            schemaVersion: 4,
            autoMovementEnabled: true,
            walkSpeedMultiplier: 1,
            gravityEnabled: true,
            edgeBehavior: "turn",
            interactionEnabled: true,
            hitAreaDebugEnabled: false,
            animationSpeedMultiplier: 1.0
          };
          await this.store.set('pet-settings', this.settings);
          await this.store.save();
        } else if (savedSettings.schemaVersion === 2) {
          this.settings = {
            ...DEFAULT_SETTINGS,
            ...savedSettings,
            schemaVersion: 4,
            interactionEnabled: savedSettings.interactionEnabled ?? true,
            hitAreaDebugEnabled: savedSettings.hitAreaDebugEnabled ?? false,
            animationSpeedMultiplier: 1.0
          };
          await this.store.set('pet-settings', this.settings);
          await this.store.save();
        } else if (savedSettings.schemaVersion === 3) {
          this.settings = {
            ...DEFAULT_SETTINGS,
            ...savedSettings,
            schemaVersion: 4,
            animationSpeedMultiplier: savedSettings.animationSpeedMultiplier ?? 1.0
          };
          await this.store.set('pet-settings', this.settings);
          await this.store.save();
        } else {
          this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
        }
      }
      
      // Defensive fallback defaults for all properties to prevent undefined errors in updateUI
      this.settings = {
        ...DEFAULT_SETTINGS,
        ...this.settings,
        scale: this.settings.scale ?? 1.0,
        alwaysOnTop: this.settings.alwaysOnTop ?? true,
        randomDialogueEnabled: this.settings.randomDialogueEnabled ?? true,
        sleepEnabled: this.settings.sleepEnabled ?? true,
        sleepDelayMinutes: this.settings.sleepDelayMinutes ?? 15,
        autoMovementEnabled: this.settings.autoMovementEnabled ?? true,
        walkSpeedMultiplier: this.settings.walkSpeedMultiplier ?? 1.0,
        gravityEnabled: this.settings.gravityEnabled ?? true,
        edgeBehavior: this.settings.edgeBehavior ?? "turn",
        interactionEnabled: this.settings.interactionEnabled ?? true,
        hitAreaDebugEnabled: this.settings.hitAreaDebugEnabled ?? false,
        animationSpeedMultiplier: this.settings.animationSpeedMultiplier ?? 1.0,
      };
    } catch (e) {
      console.error("[Settings] failed to load store", e);
    }

    this.updateUI();
    this.bindEvents();
    
    // Load character manager content
    await this.refreshCharacterManager();

    // Broadcast current settings to main window
    await this.broadcastSettings();
  }

  private updateUI() {
    if (this.scaleInput) this.scaleInput.value = this.settings.scale.toString();
    if (this.scaleValue) this.scaleValue.textContent = `${Math.round(this.settings.scale * 100)}%`;
    if (this.alwaysOnTopCheck) this.alwaysOnTopCheck.checked = this.settings.alwaysOnTop;
    if (this.randomDialogueCheck) this.randomDialogueCheck.checked = this.settings.randomDialogueEnabled;
    if (this.sleepEnabledCheck) this.sleepEnabledCheck.checked = this.settings.sleepEnabled;
    if (this.sleepDelayInput) this.sleepDelayInput.value = this.settings.sleepDelayMinutes.toString();
    if (this.autoMovementEnabledCheck) this.autoMovementEnabledCheck.checked = this.settings.autoMovementEnabled;
    if (this.walkSpeedMultiplierInput) this.walkSpeedMultiplierInput.value = this.settings.walkSpeedMultiplier.toString();
    if (this.walkSpeedMultiplierValue) this.walkSpeedMultiplierValue.textContent = `${this.settings.walkSpeedMultiplier.toFixed(1)}x`;
    if (this.gravityEnabledCheck) this.gravityEnabledCheck.checked = this.settings.gravityEnabled;
    if (this.edgeBehaviorSelect) this.edgeBehaviorSelect.value = this.settings.edgeBehavior;
    if (this.interactionEnabledCheck) this.interactionEnabledCheck.checked = this.settings.interactionEnabled;
    if (this.hitAreaDebugEnabledCheck) this.hitAreaDebugEnabledCheck.checked = this.settings.hitAreaDebugEnabled;
    if (this.animationSpeedMultiplierInput) this.animationSpeedMultiplierInput.value = this.settings.animationSpeedMultiplier.toString();
    if (this.animationSpeedMultiplierValue) this.animationSpeedMultiplierValue.textContent = this.getAnimationSpeedLabel(this.settings.animationSpeedMultiplier);
  }

  private getAnimationSpeedLabel(val: number): string {
    if (val <= 0.5) return `${val.toFixed(1)}x (非常舒缓)`;
    if (val <= 0.8) return `${val.toFixed(1)}x (舒缓)`;
    if (val <= 1.0) return `${val.toFixed(1)}x (标准)`;
    if (val <= 1.2) return `${val.toFixed(1)}x (稍快)`;
    return `${val.toFixed(1)}x (快速)`;
  }

  private bindEvents() {
    // Tabs switching
    if (this.tabButtons) {
      this.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.tabButtons.forEach(b => b.classList.remove('active'));
          this.tabContents.forEach(c => c.classList.remove('active'));
          
          btn.classList.add('active');
          const tabId = btn.dataset.tab;
          if (tabId) {
            document.getElementById(tabId)?.classList.add('active');
          }
        });
      });
    }

    if (this.scaleInput) {
      this.scaleInput.addEventListener('input', () => {
        if (this.scaleValue) this.scaleValue.textContent = `${Math.round(parseFloat(this.scaleInput.value) * 100)}%`;
      });

      this.scaleInput.addEventListener('change', async () => {
        this.settings.scale = parseFloat(this.scaleInput.value);
        await this.saveAndBroadcast();
      });
    }

    if (this.alwaysOnTopCheck) {
      this.alwaysOnTopCheck.addEventListener('change', async () => {
        this.settings.alwaysOnTop = this.alwaysOnTopCheck.checked;
        await this.saveAndBroadcast();
      });
    }

    if (this.randomDialogueCheck) {
      this.randomDialogueCheck.addEventListener('change', async () => {
        this.settings.randomDialogueEnabled = this.randomDialogueCheck.checked;
        await this.saveAndBroadcast();
      });
    }

    if (this.sleepEnabledCheck) {
      this.sleepEnabledCheck.addEventListener('change', async () => {
        this.settings.sleepEnabled = this.sleepEnabledCheck.checked;
        await this.saveAndBroadcast();
      });
    }

    if (this.sleepDelayInput) {
      this.sleepDelayInput.addEventListener('change', async () => {
        const val = parseInt(this.sleepDelayInput.value, 10);
        if (!isNaN(val) && val >= 1) {
          this.settings.sleepDelayMinutes = val;
          await this.saveAndBroadcast();
        }
      });
    }

    if (this.btnReset) {
      this.btnReset.addEventListener('click', async () => {
        if (confirm('确定要恢复默认设置吗？')) {
          this.settings = { ...DEFAULT_SETTINGS };
          this.updateUI();
          await this.saveAndBroadcast();
          await this.refreshCharacterManager();
        }
      });
    }

    if (this.btnResetPosition) {
      this.btnResetPosition.addEventListener('click', async () => {
        await emitTo('main', EVENT_RESET_POSITION, {});
      });
    }

    if (this.autoMovementEnabledCheck) {
      this.autoMovementEnabledCheck.addEventListener('change', async () => {
        this.settings.autoMovementEnabled = this.autoMovementEnabledCheck.checked;
        await this.saveAndBroadcast();
      });
    }

    if (this.walkSpeedMultiplierInput) {
      this.walkSpeedMultiplierInput.addEventListener('input', () => {
        if (this.walkSpeedMultiplierValue) this.walkSpeedMultiplierValue.textContent = `${parseFloat(this.walkSpeedMultiplierInput.value).toFixed(1)}x`;
      });

      this.walkSpeedMultiplierInput.addEventListener('change', async () => {
        this.settings.walkSpeedMultiplier = parseFloat(this.walkSpeedMultiplierInput.value);
        await this.saveAndBroadcast();
      });
    }

    if (this.gravityEnabledCheck) {
      this.gravityEnabledCheck.addEventListener('change', async () => {
        this.settings.gravityEnabled = this.gravityEnabledCheck.checked;
        await this.saveAndBroadcast();
      });
    }

    if (this.edgeBehaviorSelect) {
      this.edgeBehaviorSelect.addEventListener('change', async () => {
        this.settings.edgeBehavior = this.edgeBehaviorSelect.value as "turn" | "stop";
        await this.saveAndBroadcast();
      });
    }

    if (this.btnTestWalkLeft) {
      this.btnTestWalkLeft.addEventListener('click', async () => {
        await emitTo('main', EVENT_TEST_WALK, { direction: 'left' });
      });
    }

    if (this.btnTestWalkRight) {
      this.btnTestWalkRight.addEventListener('click', async () => {
        await emitTo('main', EVENT_TEST_WALK, { direction: 'right' });
      });
    }

    if (this.btnTestFall) {
      this.btnTestFall.addEventListener('click', async () => {
        await emitTo('main', EVENT_TEST_FALL, {});
      });
    }

    if (this.interactionEnabledCheck) {
      this.interactionEnabledCheck.addEventListener('change', async () => {
        this.settings.interactionEnabled = this.interactionEnabledCheck.checked;
        await this.saveAndBroadcast();
      });
    }

    if (this.hitAreaDebugEnabledCheck) {
      this.hitAreaDebugEnabledCheck.addEventListener('change', async () => {
        this.settings.hitAreaDebugEnabled = this.hitAreaDebugEnabledCheck.checked;
        await this.saveAndBroadcast();
      });
    }

    if (this.animationSpeedMultiplierInput) {
      this.animationSpeedMultiplierInput.addEventListener('input', () => {
        const val = parseFloat(this.animationSpeedMultiplierInput.value);
        if (this.animationSpeedMultiplierValue) this.animationSpeedMultiplierValue.textContent = this.getAnimationSpeedLabel(val);
      });

      this.animationSpeedMultiplierInput.addEventListener('change', async () => {
        this.settings.animationSpeedMultiplier = parseFloat(this.animationSpeedMultiplierInput.value);
        await this.saveAndBroadcast();
      });
    }

    // Character manager events
    if (this.btnSelectImportDir) {
      this.btnSelectImportDir.addEventListener('click', async () => {
        try {
          const path: string | null = await invoke('select_codex_directory');
          if (path) {
            const results: CodexScanResult[] = await invoke('scan_directory', { path });
            this.displayScanResults(results);
          }
        } catch (e) {
          alert('选择目录失败: ' + e);
        }
      });
    }

    if (this.btnScanCodex) {
      this.btnScanCodex.addEventListener('click', async () => {
        try {
          this.btnScanCodex.disabled = true;
          this.btnScanCodex.textContent = '扫描中...';
          const results: CodexScanResult[] = await invoke('scan_codex_pets');
          this.displayScanResults(results);
        } catch (e) {
          alert('扫描 Codex 失败: ' + e);
        } finally {
          this.btnScanCodex.disabled = false;
          this.btnScanCodex.textContent = '扫描本机 Codex';
        }
      });
    }

    if (this.btnImportAllValid) {
      this.btnImportAllValid.addEventListener('click', async () => {
        const valids = this.scanResults.filter(r => r.status === 'valid');
        if (valids.length === 0) {
          alert('无有效角色可导入！');
          return;
        }
        if (confirm(`确定要导入全部 ${valids.length} 个角色吗？`)) {
          let successCount = 0;
          for (const item of valids) {
            try {
              await invoke('install_codex_pet', { sourcePathStr: item.sourcePath });
              successCount++;
            } catch (e) {
              console.error(`Failed to import ${item.sourcePath}:`, e);
            }
          }
          alert(`成功导入 ${successCount} / ${valids.length} 个角色！`);
          if (this.scanResultsContainer) this.scanResultsContainer.style.display = 'none';
          await this.refreshCharacterManager();
        }
      });
    }
  }

  private displayScanResults(results: CodexScanResult[]) {
    this.scanResults = results;
    this.scanResultsListEl.innerHTML = '';
    
    if (results.length === 0) {
      this.scanResultsListEl.innerHTML = '<div class="empty-placeholder">未在选择目录中检索到任何 Codex 角色</div>';
      this.scanResultsContainer.style.display = 'block';
      this.btnImportAllValid.style.display = 'none';
      return;
    }

    this.scanResultsContainer.style.display = 'block';
    
    let hasValid = false;
    results.forEach(res => {
      const item = document.createElement('div');
      item.className = 'scan-item';
      
      // Thumbnail
      const thumbBox = document.createElement('div');
      thumbBox.className = 'character-preview-box';
      thumbBox.style.width = '48px';
      thumbBox.style.height = '52px';
      thumbBox.style.marginRight = '8px';
      thumbBox.style.flexShrink = '0';
      const thumb = this.createCharacterThumbnail('scan', res);
      thumbBox.appendChild(thumb);
      item.appendChild(thumbBox);

      const info = document.createElement('div');
      info.className = 'scan-info';
      
      const name = document.createElement('div');
      name.className = 'scan-name';
      name.textContent = res.manifest?.displayName || res.manifest?.id || '未命名';
      info.appendChild(name);

      const path = document.createElement('div');
      path.className = 'scan-path';
      path.textContent = res.sourcePath;
      info.appendChild(path);

      // Status Badge
      const badge = document.createElement('span');
      badge.className = 'scan-badge';
      
      if (res.status === 'valid') {
        badge.classList.add('valid');
        badge.textContent = '有效';
        hasValid = true;
      } else if (res.status === 'unsupported-version') {
        badge.classList.add('unsupported');
        badge.textContent = '版本不支持 (V2)';
      } else {
        badge.classList.add('invalid');
        badge.textContent = '格式错误';
      }
      info.appendChild(badge);

      const ver = res.manifest?.spriteVersionNumber || 1;
      const verNote = document.createElement('div');
      verNote.className = 'scan-ver-note';
      verNote.style.fontSize = '11px';
      verNote.style.color = '#7f8c8d';
      verNote.style.marginTop = '4px';
      if (ver === 2) {
        verNote.textContent = 'Codex V2 基础动画兼容 鼠标观察方向暂未启用';
      } else {
        verNote.textContent = 'Codex V1 基础动画完全兼容';
      }
      info.appendChild(verNote);

      if (res.errors.length > 0) {
        const errList = document.createElement('ul');
        errList.className = 'error-details';
        res.errors.forEach(e => {
          const li = document.createElement('li');
          li.textContent = `• ${e}`;
          errList.appendChild(li);
        });
        info.appendChild(errList);
      }

      item.appendChild(info);

      // Action Button
      const btn = document.createElement('button');
      btn.textContent = '导入';
      if (res.status === 'valid') {
        btn.addEventListener('click', async () => {
          try {
            btn.disabled = true;
            btn.textContent = '导入中...';
            const installedId = await invoke('install_codex_pet', { sourcePathStr: res.sourcePath });
            alert('导入成功！');
            // Remove from results
            this.scanResults = this.scanResults.filter(r => r.sourcePath !== res.sourcePath);
            this.displayScanResults(this.scanResults);
            
            // Ask to switch immediately
            if (confirm('是否立即切换到该角色？')) {
              this.settings.characterId = installedId as string;
              await this.saveAndBroadcast();
            }
            await this.refreshCharacterManager();
          } catch (e) {
            alert('导入失败: ' + e);
            btn.disabled = false;
            btn.textContent = '导入';
          }
        });
      } else {
        btn.disabled = true;
      }
      item.appendChild(btn);

      this.scanResultsListEl.appendChild(item);
    });

    this.btnImportAllValid.style.display = hasValid ? 'block' : 'none';
  }

  private async refreshCharacterManager() {
    // 1. Get installed list
    let installedList: InstalledCharacter[] = [];
    try {
      installedList = await invoke('list_installed_characters');
    } catch (e) {
      console.error('Failed to list installed characters:', e);
    }

    // 2. Render current character details
    if (this.settings.characterId === 'default') {
      this.currentTitleEl.textContent = 'Default Pet';
      this.currentDescEl.textContent = '内置测试史莱姆';
      this.currentSourceEl.textContent = '内置';
      this.currentSourceEl.style.background = '#e3faf2';
      this.currentSourceEl.style.color = '#0ca678';
      this.currentPreviewBox.innerHTML = '<img src="/characters/default/animations/idle/1.svg" />';
    } else {
      const current = installedList.find(c => c.id === this.settings.characterId);
      if (current) {
        this.currentTitleEl.textContent = current.displayName;
        this.currentDescEl.textContent = current.description || '无描述';
        this.currentSourceEl.textContent = 'Codex';
        this.currentSourceEl.style.background = '#ebf0f6';
        this.currentSourceEl.style.color = '#7f8c8d';

        this.currentPreviewBox.innerHTML = '';
        const thumb = this.createCharacterThumbnail('installed', current);
        this.currentPreviewBox.appendChild(thumb);
      } else {
        // Current character lost / fallback to default
        this.currentTitleEl.textContent = '加载失败';
        this.currentDescEl.textContent = '找不到该自定义角色';
        this.currentSourceEl.textContent = '错误';
        this.currentPreviewBox.innerHTML = '<div class="empty-placeholder">错误</div>';
      }
    }

    // 3. Render installed list
    this.installedListEl.innerHTML = '';

    // Add default character to list as first item
    const defaultCard = this.createCharacterCard('default', 'Default Pet', '内置测试史莱姆', 'builtin');
    this.installedListEl.appendChild(defaultCard);

    // Add custom installed characters
    for (const char of installedList) {
      const card = this.createCharacterCard(char.id, char.displayName, char.description || '无描述', 'codex-v1', char);
      this.installedListEl.appendChild(card);
    }
  }

  private createCharacterCard(id: string, name: string, desc: string, source: 'builtin' | 'codex-v1', installedChar?: InstalledCharacter, imageUrl: string = '/characters/default/animations/idle/1.svg'): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'character-item-card';
    if (this.settings.characterId === id) {
      card.classList.add('active');
    }

    // Preview
    const pBox = document.createElement('div');
    pBox.className = 'character-preview-box';
    pBox.style.width = '64px';
    pBox.style.height = '70px';
    
    if (source === 'builtin') {
      const thumb = this.createCharacterThumbnail('builtin', imageUrl);
      pBox.appendChild(thumb);
    } else if (installedChar) {
      const thumb = this.createCharacterThumbnail('installed', installedChar);
      pBox.appendChild(thumb);
    }
    card.appendChild(pBox);

    // Info
    const info = document.createElement('div');
    info.style.flex = '1';
    
    const title = document.createElement('div');
    title.className = 'char-title';
    title.textContent = name;
    info.appendChild(title);

    const description = document.createElement('div');
    description.className = 'char-desc';
    description.textContent = desc;
    info.appendChild(description);

    const badge = document.createElement('span');
    badge.className = 'char-source';
    badge.textContent = source === 'builtin' ? '内置' : 'Codex';
    info.appendChild(badge);

    card.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'char-actions';

    if (this.settings.characterId !== id) {
      const btnSwitch = document.createElement('button');
      btnSwitch.textContent = '切换';
      btnSwitch.addEventListener('click', async () => {
        this.settings.characterId = id;
        await this.saveAndBroadcast();
        await this.refreshCharacterManager();
      });
      actions.appendChild(btnSwitch);
    } else {
      const btnActive = document.createElement('button');
      btnActive.textContent = '当前角色';
      btnActive.disabled = true;
      btnActive.style.backgroundColor = '#2ecc71';
      actions.appendChild(btnActive);
    }

    if (source !== 'builtin') {
      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn-open';
      btnOpen.textContent = '打开目录';
      btnOpen.addEventListener('click', async () => {
        await invoke('open_installed_character_directory', { id });
      });
      actions.appendChild(btnOpen);

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn-delete';
      btnDelete.textContent = '删除';
      btnDelete.addEventListener('click', async () => {
        if (confirm(`确定要删除角色「${name}」吗？`)) {
          try {
            if (this.settings.characterId === id) {
              // Switch to default first if we delete current character
              this.settings.characterId = 'default';
              await this.saveAndBroadcast();
            }
            await invoke('delete_installed_character', { id });
            alert('删除成功！');
            await this.refreshCharacterManager();
          } catch (e) {
            alert('删除失败: ' + e);
          }
        }
      });
      actions.appendChild(btnDelete);
    }

    card.appendChild(actions);
    return card;
  }

  private createCharacterThumbnail(type: 'builtin' | 'installed' | 'scan', srcOrCharOrScan: string | InstalledCharacter | CodexScanResult): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'character-thumbnail';

    const img = document.createElement('img');
    const fallback = document.createElement('div');
    fallback.className = 'thumbnail-fallback';
    fallback.textContent = '?';

    img.addEventListener('load', () => {
      container.classList.remove('is-error');
    });
    img.addEventListener('error', () => {
      container.classList.add('is-error');
    });

    if (type === 'builtin') {
      img.src = srcOrCharOrScan as string;
    } else if (type === 'installed') {
      const char = srcOrCharOrScan as InstalledCharacter;
      img.src = `${convertFileSrc(char.absolutePath)}/${char.previewPath || 'preview.png'}`;
    } else {
      const scan = srcOrCharOrScan as CodexScanResult;
      if (scan.previewCachePath) {
        img.src = convertFileSrc(scan.previewCachePath);
      } else {
        container.classList.add('is-error');
      }
    }

    container.appendChild(img);
    container.appendChild(fallback);
    return container;
  }

  private async saveAndBroadcast() {
    if (this.store) {
      await this.store.set('pet-settings', this.settings);
      await this.store.save();
    }
    await this.broadcastSettings();
  }

  private async broadcastSettings() {
    console.log("[Settings] Broadcasting", this.settings);
    await emitTo('main', EVENT_SETTINGS_CHANGED, this.settings);
  }
}
