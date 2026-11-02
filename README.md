# RT Magneto · sitio web

Landing estática con escenas 3D guiadas por el scroll (Three.js + GSAP ScrollTrigger), construida con Vite.

## Uso

```bash
npm install
npm run dev       # servidor local con recarga
npm run build     # genera dist/, listo para cualquier hosting estático
npm run preview   # sirve dist/ en local
```

`dist/` usa rutas relativas, así que funciona en Netlify, Vercel, Cloudflare Pages, GitHub Pages o una subcarpeta.

## Ver la web con Playwright

```bash
npx playwright install chromium   # solo la primera vez
npm run build
npm run preview                   # deja esta terminal abierta (http://localhost:4173)
npm run capturas                  # en otra terminal
```

Guarda en `capturas/` una imagen por capítulo en escritorio (1440×900) y móvil (390×844). Con `URL=https://… npm run capturas` recorre otra dirección.

## Estructura

- `index.html`: todo el contenido y el copy (en español, sale de `content/educacion.md`).
- `src/scene.js`: la escena 3D generada por código (escalera gamma, planos Max GEX+ / Zero Gamma / Max GEX−, pivote 90DTE, traza del precio, spikes de opciones y partículas de cobertura del dealer) y los fotogramas clave de cámara por capítulo (`SCENES`).
- `src/main.js`: enlaza el scroll con la escena, la captura con puntos destacados, el formulario y las animaciones de SVG.
- `src/styles.css`: tokens de color (los mismos del indicador) y tipografía (Archivo, IBM Plex Mono, autoalojadas con Fontsource).
- `public/img/`: captura del indicador recortada de `content/assets/rt-magneto-ninjatrader-anotado.png`.

## Idiomas

El HTML está en español. `src/i18n.js` detecta el idioma del navegador del visitante (que sigue la configuración de su país o sistema) y, si es inglés, portugués, francés, alemán o italiano, cambia los textos con `src/i18n/<idioma>.json`; si no habla ninguno de esos, muestra inglés. El selector del menú permite cambiarlo y se recuerda en ese navegador.

Cada texto traducible lleva `data-i18n="clave"` (o `data-i18n-alt`, `data-i18n-aria-label`, `data-i18n-placeholder`). Para cambiar un texto, edítalo en el HTML y en `src/i18n/es.json`, y su traducción en los demás archivos. Para añadir un idioma, copia `en.json`, tradúcelo y añade el código a `LANGS` y al `<select>`.

## Accesibilidad y rendimiento

- Con `prefers-reduced-motion` la escena no se anima: muestra un fotograma fijo por capítulo y los textos aparecen sin transición.
- Sin WebGL se muestra un fondo estático; todo el contenido sigue siendo legible sin la capa 3D.
- La escena se pausa con la pestaña oculta y reduce partículas y resolución en pantallas pequeñas.

## Pendiente antes de publicar

- Enlaces reales de YouTube, TikTok y Telegram (`data-channel` en `index.html`).
- Servicio de correo para el formulario: poner su URL en `data-endpoint` del `<form data-signup>`.
- Precio y planes definitivos (se gestionan en `/admin`). Pagos con USDT y USDC.
- Texto definitivo del aviso de riesgo.

## Plataforma comercial

Cuentas de cliente (`/entrar/`, `/cuenta/`), panel de administración (`/admin/`), suscripciones con PayPal y entrega de licencias. El backend está en `server/` y necesita Node 22 y PostgreSQL. Instalación, configuración, despliegue y estado en [`docs/plataforma-comercial/`](docs/plataforma-comercial/README.md).
