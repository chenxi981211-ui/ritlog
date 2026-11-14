// Kopieert de web-app naar www/ voor de iOS-app (Capacitor). Alleen de bestanden die de app nodig heeft.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const files = ['index.html', 'styles.css', 'app.js', 'config.js', 'i18n.js', 'car3d.js', 'manifest.webmanifest', 'sw.js', 'icons', 'vendor', 'apps-script'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of files) cpSync(f, `www/${f}`, { recursive: true });
console.log('www/ klaar:', files.join(', '));
