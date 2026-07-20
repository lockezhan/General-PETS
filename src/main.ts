import { PetController } from './pet/pet-controller';

function disableBrowserContextMenu(): void {
  document.addEventListener("contextmenu", (event: MouseEvent) => {
    event.preventDefault();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  disableBrowserContextMenu();
  const controller = new PetController();
  controller.init().catch(console.error);
});
