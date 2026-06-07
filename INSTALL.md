# LaCitadel — Instalación y Build

App de escritorio (Electron) de estadísticas de Deadlock. Hecho en Puerto Rico 🇵🇷 · por Chanlaser.

## Requisitos
- **Node.js 18+** y **npm** (incluido con Node).
- Windows 10/11 (x64) para generar el instalador `.exe`.

## 1. Instalar dependencias
Desde la carpeta del proyecto (donde está `package.json`):

```
npm install
```

> Si Electron falla al instalar en Windows, el script `postinstall` ya escribe
> `node_modules/electron/path.txt`. Si aún falla, ejecuta: `npm run fix-electron`.

## 2. Probar en modo desarrollo
```
npm start
```
Abre la app. Pulsa **↻ Actualizar Todo** y abre DevTools (Ctrl+Shift+I) para ver
la consola. Busca `[hero-stats] Success: N heroes` (FASE 1 OK).

## 3. Verificar la API (recomendado antes de buildear)
Con **Node normal** (no Electron):
```
node api-check.js
```
Imprime el estado HTTP real y los nombres de campos reales de cada endpoint.
Útil para confirmar Counters/Sinergias y el parámetro de rango (`min_badge`
vs `min_average_badge`).

## 4. Generar el instalador de Windows
```
npm run build-win
```
El instalador NSIS queda en la carpeta `dist/`
(p. ej. `dist/LaCitadel Setup 1.0.0.exe`).

> macOS/Linux: `npm run build-mac` / `npm run build-linux`.
> Nota: el build de **mac** referencia `assets/icon.icns`, que **no** está
> incluido. Si vas a buildear para mac, añade ese archivo o cambia la ruta del
> icono en `package.json` → `build.mac.icon`. El build de **Windows** no lo
> necesita (usa `assets/icon.ico`, ya incluido).

## Estructura
```
LaCitadel/
├── main.js          ← proceso principal de Electron (PARCHEADO)
├── preload.js       ← puente IPC (contextBridge)
├── api-check.js     ← diagnóstico de la API (correr con node)
├── package.json     ← config + electron-builder
├── src/
│   └── index.html   ← UI completa (CSS+JS inline, español, ~430KB)
├── assets/
│   ├── icon.png · icon.ico · header.png
└── build/
    └── icon.ico
```

## Notas de seguridad / TOS
- Solo lectura. Nunca toca el cliente del juego. Respeta rate limits.
- Datos públicos de la comunidad vía deadlock-api.com.
