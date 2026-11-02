# Contrato del puente de licencias (propuesta)

**Estado: propuesta, no implementada en el servidor.** El cliente está en `server/src/licenses/engine.ts` (`BridgeLicenseEngine`). El servicio se escribirá cuando se audite el código de "RT Indicators — SSH Admin + GexBot Control" y del servidor de licencias, reutilizando su lógica para generar claves, fechas y activación. Si la auditoría muestra que ya existe una API segura, se usará esa y este contrato se adaptará a ella.

## Por qué un puente

- La web nunca se conecta a la base de licencias ni por SSH con credenciales amplias.
- El servicio corre en el mismo servidor que las licencias, usa la misma lógica que la app de escritorio y expone solo seis operaciones.
- La app de escritorio y el indicador siguen funcionando igual: leen la misma base de datos.

## Seguridad

- Escucha solo en una red privada (WireGuard, red interna del proveedor) o detrás de una lista de IPs con HTTPS.
- Cada petición lleva `X-RT-Timestamp` (segundos Unix) y `X-RT-Signature` = HMAC-SHA256 en hex, con el secreto compartido `LICENSE_BRIDGE_SECRET`, de `"{timestamp}.{MÉTODO}.{ruta con query}.{cuerpo JSON o vacío}"`. El puente rechaza firmas incorrectas y marcas de tiempo con más de 5 minutos de diferencia.
- Usuario del sistema sin privilegios y permisos mínimos sobre la base de licencias.
- Registro de cada operación, sin escribir claves completas.

## Operaciones

Formato de licencia en las respuestas:

```json
{ "licenseId": "123", "licenseKey": "…", "customerName": "…", "productRef": "RTMAGNETO",
  "hwid": null, "active": true, "expiresAt": "2026-12-01T00:00:00Z", "createdAt": "2026-11-01T10:00:00Z" }
```

| Método y ruta | Qué hace | Respuesta |
| --- | --- | --- |
| `GET /licenses/by-reference/{reference}` | Busca la licencia creada con esa referencia | Licencia o 404 |
| `GET /licenses/{id}` | Lee una licencia | Licencia o 404 |
| `POST /licenses` `{reference, customerName, customerEmail, productRef, expiresAt}` | Crea una licencia con el generador actual. **Idempotente por `reference`**: si ya existe, devuelve la misma | Licencia |
| `POST /licenses/{id}/expiry` `{expiresAt}` | Cambia el vencimiento conservando clave y HWID | 204 |
| `POST /licenses/{id}/activate` | Activa | 204 |
| `POST /licenses/{id}/deactivate` | Desactiva (no borra) | 204 |
| `GET /licenses?search=&limit=&offset=` | Lista para el panel admin, incluidas las creadas con la app | `{items, total}` |

Errores: 4xx no se reintentan (salvo 429); 5xx y errores de red se reintentan con espera creciente.

`reference` es el ID de `license_mappings` de la web. Si la base de licencias no tiene dónde guardarlo, el puente necesita una tabla propia `reference → licenseId` en el mismo servidor; se decidirá en la auditoría.

## Preguntas que resolverá la auditoría

- Cómo se genera la clave y si lleva datos firmados (fecha, producto) que obliguen a regenerarla al renovar.
- Cuándo se fija el HWID: al crear o en la primera activación desde NinjaTrader.
- Qué diferencia hay entre desactivar y eliminar en la app actual.
- Si el indicador guarda en caché la validación y cuánto tarda en ver un cambio.
