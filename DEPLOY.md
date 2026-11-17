# Guía de Despliegue en Render — AutoClean AI Backend

Esta guía detalla los pasos para desplegar el backend de AutoClean AI en el plan gratuito (**Free Tier**) de [Render](https://render.com), permitiendo que la aplicación móvil se comunique con la API desde cualquier red.

---

## 1. Crear el Servicio en Render

1. Inicia sesión en tu cuenta de [Render Dashboard](https://dashboard.render.com).
2. Haz clic en el botón **New +** y selecciona **Web Service** (o **Blueprint** para sincronizar automáticamente con `render.yaml`).
3. Conecta tu repositorio de GitHub: `https://github.com/EdedArt/AutoClean_AI.git`.
4. Configura los parámetros principales del servicio:
   - **Name**: `autoclean-ai-backend` (o el nombre de tu preferencia).
   - **Region**: Selecciona la más cercana a tus usuarios (ej. *Oregon (US West)* o *Ohio (US East)*).
   - **Branch**: Selecciona la rama de despliegue (ej. `feature/deploy-render` o `main`/`develop` una vez integrado el PR).
   - **Root Directory**: Déjalo vacío si el repositorio está en la carpeta raíz del backend, o especifica `Backend` si el repositorio contiene múltiples carpetas.
   - **Runtime**: `Node`.
   - **Build Command**: `npm install && npx prisma generate`
   - **Start Command**: `npx prisma migrate deploy && npm start`
   - **Instance Type**: `Free`.

---

## 2. Variables de Entorno (Environment Variables)

En la pestaña **Environment** de tu Web Service en Render, añade las siguientes variables. 

> [!WARNING]
> **Nunca expongas claves reales en el repositorio.** Los valores a continuación son descripciones y plantillas.

| Variable | Requerida | Descripción / Valor recomendado |
| :--- | :---: | :--- |
| `DATABASE_URL` | **Sí** | Cadena de conexión **pooled** de Neon PostgreSQL (el host contiene `-pooler`), con `?sslmode=require`. La usa la app en tiempo de ejecución. Placeholder: `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require` |
| `DIRECT_URL` | **Sí** | Cadena de conexión **directa** (sin `-pooler`) a la misma base de datos. La usa `prisma migrate deploy` en el `startCommand` (las migraciones no funcionan a través del pooler). Placeholder: `postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DBNAME?sslmode=require` |
| `JWT_SECRET` | **Sí** | Secreto criptográfico para firma de tokens (mínimo 32 caracteres). Placeholder: `<tu-secreto-jwt-min-32-caracteres>`. *Puedes generar uno con: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`* |
| `GEMINI_API_KEY` | Opcional | Clave de API de Google AI Studio para visión artificial. Placeholder: `<tu-clave-de-gemini>`. Si se omite, el sistema opera con el proveedor simulado. |
| `NODE_ENV` | Recomendada | `production` |
| `SEED_ON_BOOT` | Recomendada | `true` (Garantiza que en cada arranque se siembren las bahías, paquetes y usuarios demo). |
| `CORS_ORIGINS` | Opcional | `*` (Permite solicitudes desde la app móvil y navegadores externos). |
| `AI_MODE` | Opcional | `auto` (Usa Gemini si la clave está presente; de lo contrario usa simulación). |
| `AI_FALLBACK_TO_SIMULATED`| Opcional | `true` (Si la API de IA agota cuota o falla, responde con el motor simulado). |
| `SIMULATION_AUTO_ADVANCE` | Opcional | `true` (Avanza automáticamente el lavado de vehículos preparados). |
| `SIMULATION_PHASE_DURATION_MS` | Opcional | `60000` (Duración de cada fase en milisegundos, 1 minuto por defecto). |
| `RATE_LIMIT_WINDOW_MS` | Opcional | `60000` (Ventana de tiempo para limitador de peticiones en ms). |
| `RATE_LIMIT_MAX` | Opcional | `100` (Máximo de peticiones permitidas por ventana). |

---

## 3. Limitaciones y Comportamiento del Plan Gratuito

El plan Free de Render opera bajo restricciones específicas que el backend maneja de forma transparente:

1. **Suspensión tras inactividad (Spin-down de 15 minutos)**:
   Si el servicio no recibe peticiones durante 15 minutos, Render detiene el contenedor para ahorrar recursos.
2. **Arranque en frío (~1 minuto)**:
   Cuando llega una nueva solicitud después de la suspensión, la instancia tarda aproximadamente un minuto en encender y responder.
3. **Almacenamiento efímero (Sin disco persistente)**:
   El sistema de archivos se reinicia con cada suspensión o nuevo despliegue. Por eso **los datos viven en PostgreSQL (Neon)** y no en el disco de Render: vehículos, órdenes, usuarios y fases sobreviven a reinicios y redespliegues.
   - En cada arranque (`startCommand`), `npx prisma migrate deploy` aplica solo las migraciones pendientes (en una base ya migrada no hace nada).
   - **Excepción — fotos de evidencia:** los archivos subidos se guardan en `storage/evidence/`, que **sí está en el disco efímero** y se pierde al reiniciar. La fila `Evidence` permanece en la base, pero su URL deja de resolver. Ver sección 5.
   - Con `SEED_ON_BOOT=true`, el servidor siembra de forma **idempotente** (upserts; reiniciar nunca duplica registros):
     - Las 2 cuentas demo: Operario (`operario@autoclean.com` / `Demo12345!`) y Cliente (`cliente@autoclean.com` / `Demo12345!`).
     - Las 4 bahías de lavado (Bays 1 a 4).
     - Los paquetes de lavado (*Lavado Básico* `BASICO` y *Lavado Profundo + Polichado* `PROFUNDO_POLICHADO`), identificados por su `codigo` único.
   - No se siembran vehículos ni órdenes previas para que el propietario o cliente interactúe limpiamente desde la aplicación.

---

## 4. Verificación del Despliegue

Una vez que Render muestre el estado **Live**:

1. **Comprobar Health Check**:
   Abre en el navegador o ejecuta mediante `curl`:
   ```bash
   curl -i https://<tu-servicio-render>.onrender.com/api/health
   ```
   Debes recibir una respuesta HTTP `200 OK`:
   ```json
   {
     "status": "ok",
     "timestamp": "2026-11-02T...",
     "uptime": 12.34
   }
   ```

2. **Explorar Documentación de la API (Swagger UI)**:
   Visita en tu navegador:
   ```
   https://<tu-servicio-render>.onrender.com/api/docs
   ```

3. **Conectar la Aplicación Móvil**:
   Configura la URL base del backend en tu cliente móvil apuntando a:
   `https://<tu-servicio-render>.onrender.com`

---

## 5. Base de Datos PostgreSQL (Neon)

### Conexiones
Neon entrega dos cadenas por rama: la **pooled** (host con `-pooler`) para `DATABASE_URL` y la **directa** para `DIRECT_URL`. Ambas deben incluir `sslmode=require`. Configúralas solo en el dashboard de Render y en tu `.env` local; **nunca** en `render.yaml` ni en el repositorio.

### Migraciones
- `prisma/migrations/20261116200000_init_postgresql` es la **línea base única** para PostgreSQL (`migration_lock.toml` → `provider = "postgresql"`).
- El historial antiguo de SQLite quedó archivado en `prisma/legacy-sqlite-migrations/` (solo referencia; Prisma no lo lee).
- Los datos del antiguo `dev.db` **no se migran**: la base PostgreSQL arranca vacía y el seed crea usuarios demo, bahías y paquetes.

### Cambio único (primer despliegue con PostgreSQL)
1. En Render → Environment, reemplaza `DATABASE_URL` (antes `file:./dev.db`) por la URL pooled de Neon y añade `DIRECT_URL`.
2. Despliega. El `startCommand` aplica la línea base y `SEED_ON_BOOT=true` siembra los datos demo.
3. Verifica con la sección 4 (login demo, `/api/packages`).

### Desarrollo local
1. Crea una rama de Neon para desarrollo (no uses la de producción) y copia sus URLs a `Backend/.env` como `DATABASE_URL` y `DIRECT_URL` (ver `.env.example`).
2. `npx prisma migrate deploy` (o `npx prisma migrate dev` al crear nuevas migraciones) y luego `npm run dev`.

### Pruebas
`npm test` exige `TEST_DATABASE_URL` (y opcionalmente `TEST_DIRECT_URL`) apuntando a una **base distinta**, por ejemplo una rama `test` de Neon. El runner se niega a ejecutarse si falta o si apunta a la misma base que `DATABASE_URL`/`DIRECT_URL` del `.env`, porque las pruebas crean y modifican datos. Antes de las suites aplica `prisma migrate deploy` a la base de pruebas.

### Fotos de evidencia
Las fotos siguen en el disco efímero (`storage/evidence/`) y se pierden al reiniciar la instancia. Migrarlas a almacenamiento persistente está pendiente.
