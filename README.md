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

## Estructura

- `index.html`: todo el contenido y el copy (en español, sale de `content/educacion.md`).
- `src/scene.js`: la escena 3D generada por código (escalera gamma, planos Max GEX+ / Zero Gamma / Max GEX−, pivote 90DTE, traza del precio, spikes de opciones y partículas de cobertura del dealer) y los fotogramas clave de cámara por capítulo (`SCENES`).
- `src/main.js`: enlaza el scroll con la escena, la captura con puntos destacados, el formulario y las animaciones de SVG.
- `src/styles.css`: tokens de color (los mismos del indicador) y tipografía (Archivo, IBM Plex Mono, autoalojadas con Fontsource).
- `public/img/`: captura del indicador recortada de `content/assets/rt-magneto-ninjatrader-anotado.png`.

## Accesibilidad y rendimiento

- Con `prefers-reduced-motion` la escena no se anima: muestra un fotograma fijo por capítulo y los textos aparecen sin transición.
- Sin WebGL se muestra un fondo estático; todo el contenido sigue siendo legible sin la capa 3D.
- La escena se pausa con la pestaña oculta y reduce partículas y resolución en pantallas pequeñas.

## Pendiente antes de publicar

- Enlaces reales de YouTube, TikTok y Telegram (`data-channel` en `index.html`).
- Servicio de correo para el formulario: poner su URL en `data-endpoint` del `<form data-signup>`.
- Precio, licencia y checkout (PayPal, USDT, USDC).
- Texto definitivo del aviso de riesgo.
