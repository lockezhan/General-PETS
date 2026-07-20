import fs from 'fs';
import path from 'path';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 260">
  <circle cx="110" cy="130" r="100" fill="#a0d8ef" />
  <circle cx="70" cy="110" r="15" fill="#333" />
  <circle cx="150" cy="110" r="15" fill="#333" />
  <path d="M 80 160 Q 110 180 140 160" stroke="#333" stroke-width="8" fill="none" />
</svg>`;

const states = ['idle', 'happy', 'angry', 'dragged'];
const frames = [4, 4, 4, 1];

states.forEach((state, idx) => {
  const dir = path.join('public', 'characters', 'default', 'animations', state);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= frames[idx]; i++) {
    fs.writeFileSync(path.join(dir, `${i}.svg`), svg);
  }
});
console.log('SVGs generated');
