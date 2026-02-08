import { promises as fs } from 'fs';
import path from 'path';

import { config } from '../config.js';

export interface AppSettings {
  workerRootDir?: string;
  claudeWorkerPath?: string;
  codexWorkerPath?: string;
}

const DEFAULT_SETTINGS: AppSettings = {};

class SettingsStore {
  private settingsPath(): string {
    return path.join(config.localConfigRoot, 'settings.json');
  }

  async read(): Promise<AppSettings> {
    const file = this.settingsPath();
    try {
      const raw = await fs.readFile(file, 'utf8');
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as AppSettings) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async write(next: AppSettings): Promise<AppSettings> {
    const file = this.settingsPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const current = await this.read();
    const merged = { ...current, ...next };
    await fs.writeFile(file, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  }
}

export const settingsStore = new SettingsStore();
