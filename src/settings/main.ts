import { SettingsController } from './settings-controller';
import './settings.css';

document.addEventListener('DOMContentLoaded', () => {
  const controller = new SettingsController();
  controller.init().catch(console.error);
});
