# Plataforma comercial de RT Magneto

Cuentas de cliente, suscripciones con PayPal, entrega automática de licencias y panel de administración, integrados con la landing existente. El sistema de licencias actual (RT Indicators — SSH Admin + GexBot Control) sigue siendo el que valida el indicador en NinjaTrader; la web solo le pide crear, renovar, suspender o reactivar licencias.

## Estado

| Parte | Implementada | Probada con pruebas automáticas | Probada en PayPal Sandbox | Verificada en producción |
| --- | --- | --- | --- | --- |
| Registro, verificación, sesiones, recuperación de contraseña, roles | Sí | Sí | — | No |
| Panel del cliente (`/cuenta/`) | Sí | Sí (API) + recorrido en navegador | No | No |
| Panel admin (`/admin/`) | Sí | Sí (API) + recorrido en navegador | No | No |
| Productos y planes, creación de planes en PayPal | Sí | Sí (PayPal simulado) | **No** | No |
| Checkout de suscripción y webhooks | Sí | Sí (PayPal simulado) | **No** | No |
| Estados: gracia, impago, cancelación, reembolsos, contracargos | Sí | Sí | **No** | No |
| Correos (12 plantillas, cola, reintentos) | Sí | Sí (envío simulado) | — | No |
| Conexión con el sistema de licencias real | **No**: falta el código del servidor de licencias | Solo con el simulador | — | No |
| Indicador en NinjaTrader | No se toca | **No verificado** | — | No |

Las pruebas usan un PayPal falso y un motor de licencias **simulado** (sus claves empiezan por `SIM-`). Nada de eso es una integración real. El panel admin avisa en rojo mientras el motor sea el simulado, y el servidor se niega a arrancar en producción con él.

## Arquitectura

```
navegador ──> web estática (Vite: landing, /entrar, /cuenta, /admin)
          └─> /api ──> backend (server/, Node 22 + Fastify) ──> PostgreSQL comercial
                                 ├─> PayPal Subscriptions API (crear suscripción, leer estado, cancelar, verificar webhooks)
                                 ├─> proveedor de correo (Postmark o Resend)
                                 └─> puente de licencias ──> sistema de licencias actual (sin cambios)
PayPal ──webhook──> /api/webhooks/paypal
NinjaTrader ──valida──> servidor de licencias actual (sin cambios)
App de escritorio ──SSH──> servidor de licencias actual (sin cambios)
```

- `server/src/auth`: registro, sesiones (cookie `HttpOnly`, guardadas como hash), tokens de un solo uso, Argon2id.
- `server/src/billing`: catálogo, checkout, cliente de PayPal, webhooks y la lógica de derechos (`entitlements.ts`).
- `server/src/licenses`: interfaz `LicenseEngine`, simulador, cliente del puente y sincronización.
- `server/src/email`: plantillas, proveedores y cola.
- `server/src/jobs.ts` y `worker.ts`: cola de tareas sobre PostgreSQL y barrido de vencimientos cada 10 minutos.
- `src/app/`: páginas de cuenta y administración en JavaScript sin framework, con los estilos de la landing.

### Cómo se decide el acceso

El estado de una suscripción no se acumula evento a evento: se **deriva** de pocos datos verificados (`deriveStatus` en `entitlements.ts`):

- `access_until`: fin del periodo pagado. Lo fija un cobro confirmado (`PAYMENT.SALE.COMPLETED`) con la fecha del próximo cobro que devuelve la API de PayPal, y solo puede crecer. Un evento repetido o desordenado deja la misma fecha: **nunca se amplía dos veces**.
- `provider_status`: último estado leído de la API de PayPal (no del navegador).
- `cancel_at_period_end`, `access_revoked_at` (reembolso total, contracargo o suspensión manual).

| Situación | Estado | Licencia |
| --- | --- | --- |
| Aprobado en PayPal, sin cobro aún | `payment_pending` | No se crea |
| Periodo pagado en curso | `active` | Activa hasta `access_until` + días de gracia |
| Cancelado por el cliente | `canceled` | Activa hasta `access_until` (sin gracia) |
| Pasó `access_until` sin cobro | `grace` | Sigue activa durante la gracia del plan |
| Pasó la gracia | `unpaid` / `suspended` | Desactivada |
| Cancelado y vencido | `expired` | Desactivada |
| Reembolso total (`REFUND_POLICY=suspend`) o contracargo | `suspended` | Desactivada; nada se borra |

La licencia se sincroniza con una tarea `license.sync` que lee el estado al ejecutarse, así que repetirla no tiene efectos. Una sola licencia viva por cliente y producto (índice único). La clave se conserva en renovaciones y al volver a suscribirse.

## Puesta en marcha en local

Requisitos: Node 22 y PostgreSQL 16.

```bash
npm install                    # landing y paneles
cd server && npm install
cp .env.example .env           # en local: NODE_ENV=development, APP_URL=http://localhost:5173,
                               # MAIL_PROVIDER=console, LICENSE_ENGINE=simulated
npm run migrate
npm run create-admin -- tu@correo.com "Tu nombre"
npm run dev                    # API en :3000
cd .. && npm run dev           # web en :5173 (Vite pasa /api al backend)
```

Con `MAIL_PROVIDER=console` los correos se guardan como archivos en `server/.outbox/`.

Para ver los paneles sin PayPal hay un servidor de demostración que **borra la base de datos indicada** y simula PayPal y licencias: `cd server && npx tsx test/demo-server.ts` (usuarios `admin@demo.local` y `cliente@demo.local`, contraseña `demo-password-123`), y en otra terminal `npm run build && npx vite preview --port 4173`.

## Idiomas

Los paneles (/entrar, /cuenta, /admin) usan los mismos nueve idiomas que la landing (ES, EN, PT, FR, DE, IT, TR, FA, AR) y comparten la preferencia: el idioma elegido en la landing se mantiene en los paneles y al revés. Cada panel tiene su selector.

- Los textos se escriben en español en el código con `t('…')`; las traducciones están en `src/app/i18n/<idioma>.json`. `npm run check:i18n` (también se ejecuta en `npm run build`) falla si falta alguna.
- La API responde sus mensajes en el idioma que la página envía en `Accept-Language`. Las traducciones están en `server/src/lib/i18n.ts`, y una prueba falla si un mensaje nuevo no tiene traducción.
- Fechas e importes usan el formato del idioma elegido (en persa, el calendario persa).
- Persa y árabe se muestran de derecha a izquierda (`dir="rtl"` en `<html>`). Los paneles de la landing siguen en el lado que les deja libre la escena 3D. El CSS nuevo debe usar propiedades lógicas (`margin-inline-start`, `text-align: start`…) para que funcione en ambos sentidos.
- Pendiente: los correos automáticos siguen en español.

## Pruebas

```bash
createdb rt_comercial_test     # base de datos solo para pruebas: se borra en cada ejecución
cd server && TEST_DATABASE_URL=postgres://…/rt_comercial_test npm test
npm run typecheck
```

56 pruebas cubren los mensajes de la API en cada idioma, el envío por Brevo, registro, alta manual de usuarios y cambio de roles, inicio de sesión, bloqueo por intentos, recuperación y cambio de contraseña, CSRF, roles, checkout, verificación y rechazo de webhooks, duplicados, primera compra, renovación sin doble ampliación, cancelación con acceso hasta fin de periodo, impago con gracia y reactivación, reembolsos parciales y totales, contracargos, fallos de red del sistema de licencias, reintentos de correo, aislamiento entre clientes, resuscripción con la misma clave y acciones del panel admin.

## PayPal

1. Crea una app en [developer.paypal.com](https://developer.paypal.com/) (Sandbox) y copia `PAYPAL_CLIENT_ID` y `PAYPAL_CLIENT_SECRET`.
2. Registra un webhook a `https://tudominio.com/api/webhooks/paypal` con estos eventos y copia su ID en `PAYPAL_WEBHOOK_ID`:
   `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.RE-ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`, `PAYMENT.SALE.PENDING`, `PAYMENT.SALE.DENIED`, `PAYMENT.SALE.REFUNDED`, `PAYMENT.SALE.REVERSED`, `CUSTOMER.DISPUTE.CREATED`.
3. En `/admin/#productos` crea el producto y el plan, pulsa **Crear en PayPal** y después **Activar**. Un plan creado en PayPal no cambia de precio ni periodicidad: para otro precio se crea otro plan, y los suscriptores existentes conservan el suyo.
4. Prueba en Sandbox con una cuenta personal de prueba: compra, renovación (en Sandbox, con un plan diario), cancelación, impago y reembolso. El webhook se puede reenviar desde el panel de PayPal para comprobar que los duplicados no cambian nada.

Las disputas (`CUSTOMER.DISPUTE.CREATED`) solo se registran en la auditoría para revisión manual; el contracargo efectivo llega como `PAYMENT.SALE.REVERSED` y sí suspende el acceso.

El webhook responde 400 si la firma no es válida (no se guarda), 503 si PayPal no puede verificarla en ese momento y 500 si falla el procesamiento; en los dos últimos casos PayPal reintenta, y en el panel admin se puede reprocesar un evento fallido.

## Sistema de licencias

La plataforma habla con las licencias solo a través de `LicenseEngine` (`server/src/licenses/engine.ts`). Hoy hay dos implementaciones:

- `simulated`: en memoria, para desarrollo y pruebas.
- `bridge`: cliente HTTP de un **servicio puente** que correría junto al servidor de licencias, reutilizando su lógica. El contrato está en [puente-licencias.md](puente-licencias.md). **El lado servidor del puente no existe todavía**: se escribirá cuando se audite el código de la app de escritorio y del servidor.

Mientras tanto, si no se puede conectar, las licencias se siguen creando a mano con la app de escritorio. La web no toca claves, HWID ni la base de licencias existente.

## Correo

Plantillas en `server/src/email/templates.ts`: verificación, bienvenida, compra confirmada, clave de activación, renovación, pago fallido, periodo de gracia, cancelación, fin de acceso, licencia suspendida, licencia reactivada, recuperación de contraseña (y aviso de cuenta existente). Cada envío tiene una clave única: el mismo evento nunca manda dos correos, y un correo fallido se reintenta (o se reenvía desde el panel) sin tocar la licencia. Las claves solo se envían a la dirección verificada de la cuenta.

Proveedor recomendado: **Brevo** (`MAIL_PROVIDER=brevo`). Se usa su API HTTPS, no SMTP, así que funciona aunque el VPS bloquee los puertos de correo (DigitalOcean lo hace en muchas cuentas).

1. En Brevo, **Senders, Domains & Dedicated IPs → Domains**: añade tu dominio y crea en tu DNS los registros que indica (DKIM, código de verificación y DMARC). Sin esto los correos acaban en spam.
2. Añade el remitente de `MAIL_FROM` (por ejemplo `licencias@tudominio.com`) como sender verificado.
3. **SMTP & API → API Keys → Generate a new API key** y ponla en `MAIL_API_KEY` del `.env` del servidor. Es la clave API (empieza por `xkeysib-`), no la clave SMTP.
4. Si activaste "Authorised IPs" en Brevo, añade la IP del servidor.

También se admiten Postmark y Resend con la misma variable.

## Despliegue

El hosting debe poder ejecutar un proceso Node permanente (webhooks, cola, barrido de vencimientos) y PostgreSQL. Un hosting solo estático no basta.

Opción recomendada: un VPS con Docker. Un Droplet de DigitalOcean sirve (mínimo 1 GB de RAM; 2 GB recomendado para compilar las imágenes): instala Docker, abre solo los puertos 22, 80 y 443 en el firewall, y apunta el registro A del dominio (o un subdominio) a la IP del Droplet antes de arrancar, para que Caddy pueda obtener el certificado.

```bash
cp server/.env.example server/.env    # rellena todo, NODE_ENV=production
docker compose -f server/docker-compose.yml --env-file server/.env up -d --build
docker compose -f server/docker-compose.yml exec app npx tsx src/cli/create-admin.ts tu@correo.com "Tu nombre"
```

Caddy obtiene el certificado HTTPS de `DOMAIN` automáticamente, sirve la web y pasa `/api` al backend. Las migraciones se aplican al arrancar.

Alternativa: Render o Railway (servicio web Node con `npm start` en `server/`, PostgreSQL gestionado y la web estática como sitio aparte con una regla que reenvíe `/api/*` al servicio).

### Primer administrador

El primer administrador se crea desde la consola del servidor con `npm run create-admin -- correo "Nombre"`; la contraseña se pide por teclado (mínimo 12 caracteres). Si la cuenta ya existe, se promueve a administradora sin cambiar su contraseña. Queda en la auditoría. Los siguientes se crean desde el panel (ver abajo).

### Alta manual de usuarios y roles

En **Admin → Usuarios → Añadir cliente** se crea una cuenta de cliente con nombre y correo (por ejemplo, alguien que pagó por transferencia). El correo queda verificado y la cuenta no tiene contraseña utilizable: el cliente la elige con el enlace de invitación, válido 7 días, que se envía al crearla o después con **Enviar invitación** desde su ficha. Si el enlace caduca, también sirve "¿Olvidaste la contraseña?". Desde la ficha se le puede crear una licencia manual. El alta y cada invitación quedan en la auditoría. Al crear la cuenta se elige el rol: **Cliente** o **Administrador**.

Hay dos roles: Cliente (su panel /cuenta) y Administrador (acceso completo a /admin). En la ficha de cada usuario, **Hacer administrador** / **Quitar administrador** cambia el rol con motivo obligatorio, cierra sus sesiones y queda en la auditoría. Nadie puede cambiar su propio rol, así que siempre queda al menos un administrador. La lista de usuarios se puede filtrar por rol.

### Copias de seguridad y recuperación

- Copia diaria de PostgreSQL (`pg_dump`) fuera del servidor, y prueba de restauración.
- Guarda `DATA_ENCRYPTION_KEY` en un gestor de secretos: sin ella no se pueden volver a mostrar las claves guardadas (las licencias siguen funcionando).
- Si cae el backend, PayPal reintenta los webhooks durante días; al volver se procesan. El barrido de vencimientos corrige estados aunque se pierda algún evento.
- Si cae el sistema de licencias, las tareas `license.sync` se reintentan con espera creciente; las que agoten intentos aparecen en `/admin/#integraciones` para reintentarlas.

## Seguridad

- Contraseñas con Argon2id; tokens de sesión, verificación y recuperación guardados solo como hash.
- Cookies `HttpOnly`, `Secure` (con https), `SameSite=Lax`; token CSRF en todas las peticiones con sesión; se rechazan orígenes ajenos y cuerpos `text/plain`.
- Límite de peticiones por IP y bloqueo por cuenta tras 8 fallos en 15 minutos.
- Todas las consultas parametrizadas; validación con Zod; el frontend usa `textContent`, nunca HTML con datos.
- Permisos comprobados en el servidor; un cliente solo ve sus datos.
- Precio, plan y producto se leen de la base de datos, nunca del navegador.
- Claves de licencia cifradas con AES-256-GCM; ver la clave exige la contraseña y queda registrado.
- No se guardan datos de tarjeta (los gestiona PayPal). Los logs no incluyen cookies, tokens ni cuerpos.
- Acciones administrativas registradas con motivo en `audit_logs`.

## Lista de comprobación para producción

- [ ] Cuenta PayPal Business del país correcto, con Subscriptions habilitado
- [ ] Planes creados en PayPal live y activados en `/admin`
- [ ] Webhook live registrado con los eventos de arriba y `PAYPAL_WEBHOOK_ID` actualizado
- [ ] Dominio de correo verificado (SPF, DKIM, DMARC) y `MAIL_FROM` con ese dominio
- [ ] HTTPS activo y `APP_URL` con https
- [ ] Todas las variables de `.env.example` configuradas; `.env` fuera del repositorio
- [ ] `DATA_ENCRYPTION_KEY` guardada en lugar seguro
- [ ] Copia de seguridad automática de PostgreSQL y restauración probada
- [ ] Puente de licencias desplegado y `LICENSE_ENGINE=bridge`
- [ ] Prueba de compra real de bajo importe y su reembolso
- [ ] Prueba de renovación (plan diario en Sandbox)
- [ ] Prueba de cancelación: acceso hasta fin de periodo
- [ ] Prueba de impago: gracia y suspensión
- [ ] Prueba de activación de la clave en NinjaTrader con un HWID real
- [ ] Prueba de expiración: el indicador deja de funcionar al vencer
- [ ] La app de escritorio sigue viendo y gestionando las licencias creadas por la web
- [ ] Texto legal: términos, privacidad, política de reembolsos y aviso de riesgo

## Pendiente

- Auditar el código de la app de escritorio, del servidor de licencias y de la validación en NinjaTrader, y escribir el lado servidor del puente.
- Confirmar si ATAS usa el mismo sistema de licencias.
- Precios y planes definitivos; la landing sigue mostrando "Precio por anunciar".
- Enlace de descarga del indicador en el panel del cliente.
- Pagos con USDT y USDC: fuera de este alcance.
