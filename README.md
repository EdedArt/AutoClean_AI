# AutoClean AI — Backend

## Vehicle Ownership, Color and Per-Client Visibility (Phase 20)

Phase 20 introduces client ownership attribution, vehicle visual attributes (`color`), contact owner metadata (`ownerName`), and strict per-client visibility rules for personal vehicle tracking.

---

### 1. New Vehicle Fields

When an operator registers a vehicle or updates its owner, the following attributes are supported:

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `placa` | string | ✅ | Canonical plate in format `XXX-123` (normalized to uppercase) |
| `marca` | string | ✅ | Vehicle manufacturer (e.g. `Mazda`, `Toyota`) |
| `modelo` | string | ✅ | Vehicle model (e.g. `CX-50`, `Corolla`) |
| `color` | string | ✅ | Visual color (1 to 30 characters, e.g. `Rojo`, `Blanco`) |
| `ownerName` | string | ✅ | Full name of owner (2 to 80 characters, e.g. `Edgar Arteaga`) |
| `ownerEmail` | string (email) | Optional | Email of registered `CLIENTE` account to associate vehicle ownership |
| `ownerId` | integer (FK) | Automatic | Linked `User.id` when `ownerEmail` is provided or updated |
| `nivelSuciedad` | string (enum) | Optional | `Leve` \| `Moderado` \| `Severo` (assessed by AI in a future phase) |

---

### 2. Ownership & Client Visibility Rules

The API enforces strict data isolation based on authenticated JWT user roles:

* **`OPERARIO` (Workshop Staff):**
  * Retains complete administrative and operational visibility across the entire workshop.
  * Can register vehicles, link owners, create orders, advance phases, view all vehicle catalogs, and inspect workshop-wide metrics.

* **`CLIENTE` (Vehicle Owner):**
  * **Catalog List (`GET /api/vehicles`):** Automatically filtered. Clients only see vehicles where `vehicle.ownerId === req.user.id`. Search (`?search=...`) and pagination operate exclusively within the client's own vehicles.
  * **Vehicle Detail (`GET /api/vehicles/:id`):** Requesting a vehicle owned by another user or without an owner returns HTTP `404 Not Found` (avoids disclosing whether the vehicle exists).
  * **Orders List (`GET /api/orders`):** Automatically filtered to orders for vehicles owned by the client.
  * **Plate Tracking (`GET /api/orders/track/:placa`):** Clients can only track license plates of vehicles they own. Tracking any unowned plate returns the identical HTTP `404 Not Found` response as a non-existent plate.
  * **Predictions & Photographic Evidence (`GET /api/orders/:id/prediction`, `GET /api/orders/:orderId/evidence`):** Restricted to the owner. Returns HTTP `404 Not Found` if requested by another client.
  * **Bays & Packages (`GET /api/bays`, `GET /api/packages`):** Freely accessible to all authenticated roles.

---

### 3. Operator Workflow Example

1. **Register a Vehicle with Owner Account:**
   ```bash
   curl -X POST "http://localhost:3000/api/vehicles" \
     -H "Authorization: Bearer <OPERATOR_JWT>" \
     -H "Content-Type: application/json" \
     -d '{
       "placa": "XYZ-123",
       "marca": "Mazda",
       "modelo": "CX-50",
       "color": "Rojo",
       "ownerName": "Edgar Arteaga",
       "ownerEmail": "cliente@autoclean.com"
     }'
   ```
   *If `ownerEmail` is not found, returns `404 OWNER_NOT_FOUND`. If the user is an `OPERARIO`, returns `400 INVALID_OWNER`.*

2. **Link or Transfer Owner Account Later:**
   ```bash
   curl -X PATCH "http://localhost:3000/api/vehicles/1/owner" \
     -H "Authorization: Bearer <OPERATOR_JWT>" \
     -H "Content-Type: application/json" \
     -d '{ "ownerEmail": "cliente@autoclean.com" }'
   ```

3. **Owner Client Views Own Vehicles:**
   ```bash
   curl -X GET "http://localhost:3000/api/vehicles" \
     -H "Authorization: Bearer <CLIENT_JWT>"
   ```

---

### 4. Known Limitations & Security Roadmap

> [!NOTE]
> **Static Evidence Access:** Photo evidence files stored on disk and served statically at `/evidence/*` are publicly accessible by their direct URL using high-entropy random filenames. In an upcoming phase, static file serving will be migrated to authenticated streams or signed temporary URLs.

---

## JWT Authentication with Roles (Phase 19)

The backend implements stateless JWT-based authentication and Role-Based Access Control (RBAC) with two primary user roles:
* **`OPERARIO`**: Car wash staff responsible for physical workshop operations (registering vehicles, creating orders, updating wash phases, uploading photographic evidence, and inspecting bay utilization).
* **`CLIENTE`**: Car owners using mobile/web interfaces for read-only tracking and inspection of service progress, predictions, and photographic evidence.

---

### 1. Authentication Architecture & Flow

* **Self-Registration (`POST /api/auth/register`):**
  * Public endpoint for new users.
  * Required fields: `nombre`, `email`, `password` (minimum 8 characters).
  * **Role Restriction:** Public registration **ALWAYS** assigns the role `CLIENTE`. Any `rol` field supplied in the request body is strictly ignored to prevent privilege escalation.
  * Duplicate email addresses return HTTP `409 Conflict` with unified error code `DUPLICATE_RESOURCE`.
  * Response returns HTTP `201 Created` with user details (excluding `passwordHash`).

* **Login (`POST /api/auth/login`):**
  * Required fields: `email`, `password`.
  * Returns a signed JWT token along with sanitized user info:
    ```json
    {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 1,
        "nombre": "Operario Demo",
        "email": "operario@autoclean.com",
        "rol": "OPERARIO"
      }
    }
    ```
  * **Anti-User-Enumeration Protection:** Unknown email addresses and incorrect passwords return identical HTTP `401 Unauthorized` responses with code `INVALID_CREDENTIALS` and the message `"Invalid email or password"`.

* **Authenticated Profile (`GET /api/auth/me`):**
  * Requires valid `Authorization: Bearer <token>` header.
  * Returns the currently authenticated user's profile (`id`, `nombre`, `email`, `rol`, `createdAt`).

* **Password Security:**
  * Passwords hashed using `bcryptjs` with salt rounds = 10.
  * `passwordHash` is never selected, returned in API payloads, or exposed in logs.

* **Rate Limiting Protection:**
  * Auth endpoints (`/api/auth/register`, `/api/auth/login`) are protected by a strict dedicated rate limiter (`RATE_LIMIT_AUTH_MAX`, default 10 requests per minute per IP) to mitigate brute-force and credential stuffing attacks.

---

### 2. Roles & Permissions Matrix

| Endpoint | Method | Public | `CLIENTE` | `OPERARIO` | Notes |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `/api/health` | `GET` | ✅ | ✅ | ✅ | System health probe |
| `/api/docs*` | `GET` | ✅ | ✅ | ✅ | Interactive Swagger UI & OpenAPI spec |
| `/evidence/*` | `GET` | ✅ | ✅ | ✅ | Static evidence photo asset delivery |
| `/api/auth/register` | `POST` | ✅ | ✅ | ✅ | Self-registration (always creates `CLIENTE`) |
| `/api/auth/login` | `POST` | ✅ | ✅ | ✅ | Issues signed JWT token |
| `/api/auth/me` | `GET` | ❌ | ✅ | ✅ | Returns current user profile |
| `/api/vehicles` | `GET` | ❌ | ✅ (Own) | ✅ (All) | List & search vehicles (paginated) |
| `/api/vehicles/:id` | `GET` | ❌ | ✅ (Own) | ✅ (All) | Retrieve vehicle details |
| `/api/vehicles` | `POST` | ❌ | ❌ (403) | ✅ | Register new workshop vehicle |
| `/api/vehicles/:id/owner` | `PATCH` | ❌ | ❌ (403) | ✅ | Link or update vehicle owner by client email |
| `/api/orders` | `GET` | ❌ | ✅ (Own) | ✅ (All) | List & filter orders (paginated) |
| `/api/orders/:id` | `GET` | ❌ | ✅ (Own) | ✅ (All) | Order details with bay & package info |
| `/api/orders` | `POST` | ❌ | ❌ (403) | ✅ | Create new service order |
| `/api/orders/:id/phase` | `PATCH` | ❌ | ❌ (403) | ✅ | Manual phase transition |
| `/api/orders/:id/simulate/*` | `POST` | ❌ | ❌ (403) | ✅ | Demo simulation controls (advance/pause/resume) |
| `/api/orders/:orderId/evidence` | `POST` | ❌ | ❌ (403) | ✅ | Upload photographic evidence |
| `/api/orders/:orderId/evidence` | `GET` | ❌ | ✅ | ✅ | List photo evidence for order |
| `/api/orders/track/:placa` | `GET` | ❌ | ✅ | ✅ | Read-only order tracking with AI prediction |
| `/api/orders/:id/prediction` | `GET` | ❌ | ✅ | ✅ | AI completion time prediction |
| `/api/bays` | `GET` | ❌ | ✅ | ✅ | List washing bays |
| `/api/bays/summary` | `GET` | ❌ | ❌ (403) | ✅ | Real-time bay occupancy metrics badge |
| `/api/packages` | `GET` | ❌ | ✅ | ✅ | List service packages |

---

### 3. Demo Credentials

The database seed (`npm run prisma:seed` or `npx prisma db seed`) populates two demo accounts for testing:

| Role | Email | Password | Access Level |
| :--- | :--- | :--- | :--- |
| **`OPERARIO`** | `operario@autoclean.com` | `Demo12345!` | Full operational privileges (create orders, advance phases, upload evidence, view bay summary) |
| **`CLIENTE`** | `cliente@autoclean.com` | `Demo12345!` | Read-only tracking privileges (tracking by plate, orders list, predictions, evidence) |

> [!IMPORTANT]
> **DEMO ONLY:** These accounts and passwords are provided strictly for local development and demonstration. They must never be deployed or used in production environments.

---

### 4. Interactive Testing with Swagger UI ("Authorize" Button)

The OpenAPI 3.0 documentation supports interactive JWT testing directly in your browser:

1. Open [http://localhost:3000/api/docs](http://localhost:3000/api/docs) in your browser.
2. In the **Authentication** section, expand `POST /api/auth/login` and click **Try it out**.
3. In the request body, enter the demo credentials for an operario or cliente:
   ```json
   {
     "email": "operario@autoclean.com",
     "password": "Demo12345!"
   }
   ```
4. Click **Execute**. In the response body, copy the string value inside the `"token"` field.
5. Scroll to the top of the page and click the green **Authorize** 🔓 button.
6. In the modal, paste the copied token into the **Value** field and click **Authorize**, then click **Close**. The lock icon will change to locked (🔒).
7. Now all protected requests (e.g., `POST /api/orders`, `GET /api/bays/summary`, or `GET /api/auth/me`) will automatically transmit the `Authorization: Bearer <token>` header when you execute them!

---

## Security & Configuration (Phase 18)

The backend incorporates production-grade HTTP security, Zod-based environment validation, CORS policies optimized for mobile clients, granular rate limiting, and request payload size defenses.

### 1. Environment Variables & Validation

Environment variables are validated on startup via Zod in `src/config/env.js`. If any required variable is missing or invalid, the server logs a detailed error identifying the problem variable and terminates immediately (`exit(1)`).

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | number | `3000` | Port on which the HTTP server listens |
| `NODE_ENV` | `development` \| `test` \| `production` | `development` | Runtime environment mode |
| `DATABASE_URL` | string | *Required* | Prisma connection URI (e.g. `file:./prisma/dev.db`) |
| `SIMULATION_PHASE_DURATION_MS` | number | `60000` | Duration of each wash cycle phase in ms |
| `CORS_ORIGINS` | string | `*` | Comma-separated list of allowed origins (or `*` for all) |
| `RATE_LIMIT_WINDOW_MS` | number | `60000` | Time window for rate limiting in ms |
| `RATE_LIMIT_MAX` | number | `100` | Max requests per IP in window for `/api` routes |
| `RATE_LIMIT_EVIDENCE_MAX` | number | `20` | Max requests per IP in window for evidence upload |
| `RATE_LIMIT_AUTH_MAX` | number | `10` | Max requests per IP in window for auth routes |
| `JWT_SECRET` | string | *Required (min 32 chars)* | Secret key used to sign and verify JWT tokens |
| `JWT_EXPIRES_IN` | string | `1d` | Expiration time for generated JWT tokens (e.g. `1d`, `12h`) |

---

### 2. CORS Setup for Mobile & Hybrid Clients

* **Native Mobile Apps & CLI (`curl`, Postman):** Send no `Origin` header. Requests without an `Origin` header are **always permitted**.
* **Web / Hybrid Mobile Apps:** Validated against `CORS_ORIGINS`. If `CORS_ORIGINS=*`, all origins are allowed. If set to a comma-separated list (e.g., `https://mobile.autoclean.com,https://dashboard.autoclean.com`), only requests matching one of the whitelisted origins receive the `Access-Control-Allow-Origin` header.
* **Allowed Methods:** `GET`, `POST`, `PATCH`, `OPTIONS`.
* **Allowed Headers:** `Content-Type`, `Authorization` (configured for upcoming JWT token authentication).
* **Preflight Handling:** Full preflight `OPTIONS` requests handled automatically with HTTP 200/204.

---

### 3. Helmet & HTTP Headers

* **`x-powered-by`:** Disabled across all responses to prevent framework fingerprinting.
* **Security Headers:** Standard Helmet protection applied globally (e.g., `X-Content-Type-Options: nosniff`).
* **Swagger UI Exception:** Content-Security-Policy (CSP) is relaxed specifically on `/api/docs` so Swagger UI scripts, inline styles, and web assets render interactively.
* **Cross-Origin Evidence Access:** `Cross-Origin-Resource-Policy: cross-origin` is applied to `/evidence` static files so that mobile applications and external frontends can render uploaded photos without browser blocking.

---

### 4. Rate Limiting Behavior

* **Global Limiter (`/api/*`):** Allows up to `RATE_LIMIT_MAX` (default 100) requests per `RATE_LIMIT_WINDOW_MS` (default 60 seconds) per IP.
* **Evidence Upload Limiter:** Stricter limiter on `POST /api/orders/:orderId/evidence` (`RATE_LIMIT_EVIDENCE_MAX`, default 20 req/min) to prevent disk and network abuse.
* **Exempt Routes:** `GET /api/health` and `/api/docs` are never rate-limited.
* **Test Mode:** Automatically skipped when `NODE_ENV === "test"` (unless `RATE_LIMIT_MAX` is specifically set low to test rate limiting) to ensure test suites run smoothly.
* **Unified 429 Response Format:**
  ```json
  {
    "error": {
      "code": "RATE_LIMITED",
      "message": "Too many requests, please try again later."
    }
  }
  ```
* Standard headers `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` are sent with every response.

---

### 5. Request Body Size Limits

* **JSON Limit:** Express parses JSON bodies up to `100kb` (`express.json({ limit: '100kb' })`).
* **Payload Too Large (413):** Requests exceeding the limit return HTTP 413 in the unified error format:
  ```json
  {
    "error": {
      "code": "PAYLOAD_TOO_LARGE",
      "message": "Request payload exceeds the maximum allowed limit of 100 KB"
    }
  }
  ```

---

## Search, Filters, Pagination and Bay Summary (Phase 17)

To optimize mobile performance and avoid unbounded queries on client devices, list endpoints return a standard pagination envelope. The API provides robust filtering by phase, bay, plate, search across vehicles, and an operator bay summary badge endpoint.

### Standard Pagination Envelope

`GET /api/vehicles` and `GET /api/orders` wrap their collections in a uniform JSON envelope:

```json
{
  "data": [
    { /* entity record */ }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 24,
    "totalPages": 3
  }
}
```

* **Out-of-range pages:** Requesting a page beyond `totalPages` (e.g., `?page=999`) returns HTTP 200 with `data: []` and accurate `meta` counters.

### 1. Vehicle Search & Pagination (`GET /api/vehicles`)

Supports full-text partial search matching license plate (`placa`), make (`marca`), or model (`modelo`) using case-insensitive ASCII LIKE matching, ordered by `createdAt desc`.

* **Query Parameters:**
  * `page` (optional integer, min: 1, default: `1`)
  * `limit` (optional integer, min: 1, max: 50, default: `10`)
  * `search` (optional string, 1 to 20 characters)

**Example cURL:**
```bash
# Search vehicles for "maz" with limit 5
curl "http://localhost:3000/api/vehicles?search=maz&page=1&limit=5"
```

---

### 2. Order Filters, Sorting & Pagination (`GET /api/orders`)

Supports comprehensive relational filters, phase matching, active order exclusion, timestamp sorting, and pagination.

* **Query Parameters:**
  * `page` (optional integer, min: 1, default: `1`)
  * `limit` (optional integer, min: 1, max: 50, default: `10`)
  * `placa` (optional string, normalized to uppercase, partial match on vehicle plate)
  * `fase` (optional enum: `"RECIBIDO" | "LAVADO" | "SECADO" | "LISTO"`)
  * `bayId` (optional positive integer)
  * `activeOnly` (optional boolean string: `"true"` excludes orders in `LISTO`)
  * `sort` (optional enum: `"newest" | "oldest"`, default: `"newest"`)

**Example cURLs:**
```bash
# Filter active orders in LAVADO phase, newest first
curl "http://localhost:3000/api/orders?fase=LAVADO&activeOnly=true&sort=newest"

# Filter orders by vehicle plate
curl "http://localhost:3000/api/orders?placa=XYZ&page=1&limit=10"
```

---

### 3. Bay Occupancy Summary (`GET /api/bays/summary`)

Provides real-time occupancy statistics from the `Bay` table to feed the operator UI badge (e.g., *"Bahías: 2/4 Ocupadas"*).

* **Endpoint:** `GET /api/bays/summary`
* **Response (200 OK):**
  ```json
  {
    "total": 4,
    "occupied": 2,
    "free": 2
  }
  ```

**Example cURL:**
```bash
curl http://localhost:3000/api/bays/summary
```

---

## Interactive API Documentation with Swagger/OpenAPI (Phase 16)

The API includes comprehensive OpenAPI 3.0.3 documentation with interactive Swagger UI, enabling mobile developers (Android & iOS) to explore, inspect schemas, and test all endpoints without reading backend code.

* **Interactive Swagger UI:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
* **Raw OpenAPI 3.0 JSON Spec:** [http://localhost:3000/api/docs.json](http://localhost:3000/api/docs.json)

### How to Try the Car Wash Simulation from Swagger UI

Open [http://localhost:3000/api/docs](http://localhost:3000/api/docs) in your browser and follow this step-by-step interactive workflow:

1. **Register a Vehicle (`POST /api/vehicles`):**
   * Expand the `POST /api/vehicles` endpoint under the **Vehicles** tag and click **Try it out**.
   * Use the sample payload (plate in `XXX-123` format):
     ```json
     {
       "placa": "XYZ-123",
       "marca": "Mazda",
       "modelo": "CX-5",
       "nivelSuciedad": "Moderado"
     }
     ```
   * Click **Execute**. Verify the `201 Created` response and note the returned vehicle `id` (e.g. `1`).

2. **Create a Service Order (`POST /api/orders`):**
   * Expand `POST /api/orders` under the **Orders** tag and click **Try it out**.
   * Assign the vehicle to an available bay and package:
     ```json
     {
       "vehicleId": 1,
       "packageId": 1,
       "bayId": 1
     }
     ```
   * Click **Execute**. The order is created in initial phase `"RECIBIDO"` with `10%` progress. Note the order `id`.

3. **Advance Phase via Demo Controls (`POST /api/orders/{id}/simulate/advance`):**
   * Expand `POST /api/orders/{id}/simulate/advance` under the **Simulation** tag and click **Try it out**.
   * Enter the order `id` and click **Execute**.
   * The order immediately advances to `"LAVADO"` with `45%` progress, resetting the background simulation timer.

4. **Upload Photo Evidence (`POST /api/orders/{orderId}/evidence`):**
   * Expand `POST /api/orders/{orderId}/evidence` under the **Evidence** tag and click **Try it out**.
   * Enter the order `id`, choose an image file (JPEG, PNG, or WEBP under 5 MB) via the file picker, and set `etapa` to `"LAVADO"`.
   * Click **Execute** and verify the `201 Created` response with the static image URL.

5. **Track Vehicle with AI Prediction (`GET /api/orders/track/{placa}`):**
   * Expand `GET /api/orders/track/{placa}` under the **Orders** tag and click **Try it out**.
   * Enter plate `"XYZ-123"` and click **Execute**.
   * Inspect the returned payload containing the vehicle, bay, package, current progress, and embedded `prediction`:
     ```json
     {
       "id": 1,
       "faseActual": "LAVADO",
       "porcentajeProgreso": 45,
       "prediction": {
         "estimatedDeliveryTime": "2026-10-23T17:35:00.000Z",
         "accuracyPercentage": 94,
         "recalculated": false,
         "message": null
       }
     }
     ```

6. **Complete the Order (`POST /api/orders/{id}/simulate/complete`):**
   * Expand `POST /api/orders/{id}/simulate/complete` under **Simulation** and click **Execute**.
   * The order transitions to `"LISTO"` (100% progress). Checking prediction now yields `accuracyPercentage: 100`.

---

## Centralized Error Handling (Phase 15)

The API enforces a single, uniform JSON error format across all endpoints (validation, business conflicts, not found, upload errors, unhandled exceptions, and unknown routes) to provide predictable error parsing for mobile clients (Android & iOS).

### Unified Error Format

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable error description",
    "details": [
      {
        "field": "placa",
        "message": "Placa must be in format XXX-123 (three letters, hyphen, three digits)"
      }
    ]
  }
}
```
> Note: The `details` array is included only when field-specific information is available (such as schema validation errors).

### Error Codes Reference

| Error Code | HTTP Status | Description / Trigger Scenario |
|---|---|---|
| `ROUTE_NOT_FOUND` | `404 Not Found` | Request sent to an unregistered route or HTTP method |
| `NOT_FOUND` | `404 Not Found` | Requested vehicle, service order, bay, or package was not found |
| `VALIDATION_ERROR` | `400 Bad Request` | Zod schema validation failed on body, params, or query |
| `INVALID_JSON` | `400 Bad Request` | Malformed JSON payload sent in request body |
| `INVALID_REFERENCE` | `400 Bad Request` | Prisma foreign key reference failure |
| `ORDER_COMPLETED` | `400 Bad Request` | Attempted to force-advance an order that is already completed (`LISTO`) |
| `FILE_MISSING` | `400 Bad Request` | Evidence upload endpoint called without an image file |
| `INVALID_FILE_TYPE` | `400 Bad Request` | Uploaded file is not JPEG, PNG, or WEBP |
| `FILE_TOO_LARGE` | `413 Payload Too Large` | Uploaded file exceeds the 5 MB maximum size limit |
| `DUPLICATE_RESOURCE` | `409 Conflict` | Unique constraint violation (e.g. vehicle plate already exists) |
| `BAY_OCCUPIED` | `409 Conflict` | Attempted to create a service order on an already occupied bay |
| `INTERNAL_ERROR` | `500 Internal Server Error` | Unexpected unhandled server exception |

### Production vs Development Behavior
* **Production (`NODE_ENV=production`):** Internal error details and stack traces are strictly suppressed to prevent security leaks. Unhandled exceptions return generic `Internal Server Error`.
* **Development:** The complete error stack trace is returned in an adjacent `stack` field for rapid debugging.
* **Console Logging:** All errors are logged to `console.error` with full stack traces regardless of environment.
* **Process Resilience:** Process-level listeners (`unhandledRejection` and `uncaughtException`) protect the Node process from silent failure, and simulation scheduler loops are wrapped in safe error catchers.

---

## Input Validation with Zod (Phase 14)

All request inputs (body and route parameters) are validated using schemas built with **Zod** via the centralized `validate(schema, source)` middleware, throwing `AppError` mapped to `VALIDATION_ERROR`.

### Schema Rules & Normalization

1. **Vehicles (`POST /api/vehicles`):**
   * `placa`: Required string. Formatted as three letters, hyphen, and three digits (`XXX-123`). Automatically normalized to uppercase (e.g., `"xyz-123"` becomes `"XYZ-123"`).
   * `marca`: Required non-empty string.
   * `modelo`: Required non-empty string.
   * `nivelSuciedad`: Required enum with values: `"Leve" | "Moderado" | "Severo"`.

2. **Service Orders (`POST /api/orders`, `PATCH /api/orders/:id/phase`):**
   * `vehicleId`: Required positive integer (coerced).
   * `packageId`: Optional positive integer (coerced).
   * `bayId`: Optional positive integer (coerced). If the designated bay is already occupied (`ocupada: true`), returns `409 Conflict` with code `"BAY_OCCUPIED"`.
   * `faseActual`: Validated against canonical phases: `"RECIBIDO" | "LAVADO" | "SECADO" | "LISTO"`.

3. **Common Route Parameters:**
   * `:id` / `:orderId`: Coerced positive integers. Non-numeric or negative values return `400 Bad Request` with code `"VALIDATION_ERROR"`.
   * `:placa`: Validated against `XXX-123` pattern and normalized to uppercase.

4. **Evidence Uploads (`POST /api/orders/:orderId/evidence`):**
   * Validates `:orderId` parameter before file processing.
   * `etapa`: Optional string validated against canonical phases (`RECIBIDO`, `LAVADO`, `SECADO`, `LISTO`).
   * **Orphan File Cleanup:** If Multer persists an uploaded image and subsequent validation fails (such as an invalid `etapa`), the temporary file is immediately removed from disk to avoid orphan artifacts.

---

## Demo Control Endpoints (Phase 12)

Manual override endpoints designed for live presentations and UI testing, allowing operators to force order status changes without waiting for the background simulation timer:

### 1. Force Advance Phase
Advances an active order to its next phase (`RECIBIDO -> LAVADO -> SECADO -> LISTO`), recalculating progress percentage and resetting the simulation timer.

* **Endpoint:** `POST /api/orders/:id/simulate/advance`
* **Response (Success):** `200 OK` with updated order object.
* **Response (Already Finished):** `400 Bad Request` with `{"error": {"code": "ORDER_COMPLETED", "message": "Order is already completed."}}`.
* **Response (Not Found):** `404 Not Found` with `{"error": {"code": "NOT_FOUND", "message": "Service order not found"}}`.
* **Console Log:** `[DEMO] Order #<id> force-advanced <currentPhase> -> <nextPhase>`

**Example cURL:**
```bash
curl -X POST http://localhost:3000/api/orders/1/simulate/advance
```

---

### 2. Reset Order to Start
Resets an order back to `faseActual: "RECIBIDO"` and `porcentajeProgreso: 10`, resetting the simulation timer to zero.

* **Endpoint:** `POST /api/orders/:id/simulate/reset`
* **Response:** `200 OK` with updated order object.
* **Console Log:** `[DEMO] Order #<id> reset to RECIBIDO`

**Example cURL:**
```bash
curl -X POST http://localhost:3000/api/orders/1/simulate/reset
```

---

### 3. Force Complete Order
Instantly moves an order to `faseActual: "LISTO"` and `porcentajeProgreso: 100`.

* **Endpoint:** `POST /api/orders/:id/simulate/complete`
* **Response:** `200 OK` with updated order object.
* **Console Log:** `[DEMO] Order #<id> force-completed`

**Example cURL:**
```bash
curl -X POST http://localhost:3000/api/orders/1/simulate/complete
```

---

## Auto-Simulation Engine (Phase 11)

The backend includes a background scheduler (`setInterval` every ~10s) that automatically advances active orders based on elapsed time:
* **Configuration:** `SIMULATION_PHASE_DURATION_MS` in `.env` (default: `60000` = 1 minute per phase).
* Any manual update (via standard `PATCH /api/orders/:id/phase` or demo control endpoints) updates `updatedAt`, resetting the timer so that the background scheduler never immediately overrides demo actions.
* **Error Resilience:** The scheduler callback runs within a guarded `try/catch` block, logging `[SIMULATION] error:` to prevent background timer crashes.

---

## AI Delivery Time Prediction (Phase 13)

Simulated deterministic prediction engine providing realistic delivery time estimates and confidence percentages for client tracking:

### 1. Dedicated Prediction Endpoint
Fetches delivery prediction metrics for a specific order.

* **Endpoint:** `GET /api/orders/:id/prediction`
* **Response (Active Order - 200 OK):**
  ```json
  {
    "estimatedDeliveryTime": "2026-10-19T16:05:00.000Z",
    "accuracyPercentage": 94,
    "recalculated": false,
    "message": null
  }
  ```
* **Response (Delayed Order - 200 OK):**
  ```json
  {
    "estimatedDeliveryTime": "2026-10-19T16:07:30.000Z",
    "accuracyPercentage": 94,
    "recalculated": true,
    "message": "Tiempo recalculado por posible retraso"
  }
  ```
* **Response (Completed Order `LISTO` - 200 OK):**
  ```json
  {
    "estimatedDeliveryTime": "2026-10-19T15:45:00.000Z",
    "accuracyPercentage": 100,
    "recalculated": false,
    "message": null
  }
  ```
* **Response (Not Found):** `404 Not Found` with unified format code `"NOT_FOUND"`.
* **Response (Invalid ID):** `400 Bad Request` with unified format code `"VALIDATION_ERROR"`.

**Example cURL:**
```bash
curl http://localhost:3000/api/orders/1/prediction
```

---

### 2. Vehicle Tracking with Embedded Prediction
Retrieves current service order for a vehicle plate with prediction data embedded alongside order details.

* **Endpoint:** `GET /api/orders/track/:placa`
* **Response (200 OK):**
  ```json
  {
    "id": 1,
    "faseActual": "LAVADO",
    "porcentajeProgreso": 45,
    "vehicle": { "placa": "ABC-123" },
    "package": { "nombre": "Lavado Premium" },
    "bay": { "nombre": "Bahía 1" },
    "prediction": {
      "estimatedDeliveryTime": "2026-10-19T16:05:00.000Z",
      "accuracyPercentage": 94,
      "recalculated": false,
      "message": null
    }
  }
  ```

**Example cURL:**
```bash
curl http://localhost:3000/api/orders/track/ABC-123
```

---

### Prediction Engine Rules:
* **Remaining Time Calculation:** `(remaining phases count) * SIMULATION_PHASE_DURATION_MS`. Reuses canonical sequence `RECIBIDO (3) -> LAVADO (2) -> SECADO (1) -> LISTO (0)`.
* **Deterministic Accuracy Percentage:** Pseudo-random value between `88` and `97` seeded by the order's ID. Consistent across repeated calls for the same order.
* **Completion Handling:** When `faseActual === "LISTO"`, `estimatedDeliveryTime` returns actual finish time (`updatedAt`), `accuracyPercentage` is `100`, `recalculated` is `false`, and `message` is `null`.
* **Delay Detection:** If elapsed time in current phase exceeds `SIMULATION_PHASE_DURATION_MS` and the order is not in `LISTO`, flags `recalculated: true` and `message: "Tiempo recalculado por posible retraso"`.

---

## Running Tests

Execute the complete test suite (simulation, integration, demo controls, prediction, validation, and error handling):
```bash
npm test
```
