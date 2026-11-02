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
| `DATABASE_URL` | **Sí** | Ruta del archivo SQLite para Prisma. Usar: `file:./dev.db` |
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
   El sistema de archivos se reinicia con cada suspensión o nuevo despliegue, por lo que la base de datos SQLite no persiste indefinidamente:
   - En cada arranque (`startCommand`), se ejecuta `npx prisma migrate deploy` para reconstruir la estructura relacional.
   - Con `SEED_ON_BOOT=true`, el servidor recrea automáticamente de forma **idempotente**:
     - Las 2 cuentas demo: Operario (`operario@autoclean.com` / `Demo12345!`) y Cliente (`cliente@autoclean.com` / `Demo12345!`).
     - Las 4 bahías de lavado (Bays 1 a 4).
     - Los paquetes de lavado (*Lavado Básico* y *Lavado Profundo + Polichado*).
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
