# AutoClean AI — Backend

## Gemini Vision & Phase Detection (Phase 22)

Phase 22 integrates multimodal computer vision using Google Gen AI (`@google/genai`) to automate bay operations. Camera frames of vehicles in wash bays are analyzed to read Colombian license plates (`XXX-123`) and classify the current wash phase (`PENDIENTE`, `REMOJO`, `LAVADO`, `SECADO`, `LISTO`). When the detected plate matches the order's vehicle, the phase advances automatically via `changePhase(orderId, phase, { source: "AI" })`.

---

### 1. End-to-End Operator Workflow

The complete camera frame analysis workflow follows these steps:

```
[1. Login as Operario] ──► [2. Create Vehicle & Order] ──► [3. Mark Ready to Wash] ──► [4. AI Vision Analysis]
    POST /api/auth/login        POST /api/vehicles            POST /api/orders/:id/ready    POST /api/orders/:id/analyze
    (Bearer Token)              POST /api/orders              (listoParaLavar: true)        (Upload photo frame)
```

1. **Authenticate as Workshop Staff (`OPERARIO`):**
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"operario@autoclean.com","password":"Demo12345!"}' | jq -r '.token')
   ```

2. **Register Vehicle & Create Service Order:**
   ```bash
   # Register vehicle
   curl -X POST http://localhost:3000/api/vehicles \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"placa":"XYZ-123","marca":"Mazda","modelo":"CX-50","color":"Rojo","ownerName":"Edgar Arteaga"}'

   # Create order in Bay 1
   curl -X POST http://localhost:3000/api/orders \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"vehicleId":1,"packageId":1,"bayId":1}'
   ```

3. **Mark Vehicle Ready to Wash:**
   ```bash
   curl -X POST http://localhost:3000/api/orders/1/ready \
     -H "Authorization: Bearer $TOKEN"
   ```

4. **Send Camera Frame for AI Analysis:**
   ```bash
   curl -X POST http://localhost:3000/api/orders/1/analyze \
     -H "Authorization: Bearer $TOKEN" \
     -F "image=@path/to/car_in_bay.jpg" \
     -F "saveEvidence=true"
   ```

> [!TIP]
> **Recommended Setting for AI Demos:**
> When testing or demonstrating the AI camera vision pipeline, set `SIMULATION_AUTO_ADVANCE=false` in your `.env` (or environment). This stops the automated time-based simulation timer from auto-advancing phases in the background, allowing the AI camera frames to exclusively drive the car wash progression.

---

### 2. Provider Architecture & Automatic Fallback

The backend abstracts vision providers under `src/services/ai/index.js` with three operating modes:

| Mode (`AI_MODE`) | Behavior | Fallback on Gemini Failure |
| :--- | :--- | :--- |
| `auto` *(default)* | Uses Gemini if `GEMINI_API_KEY` is configured; otherwise uses simulated provider | If Gemini fails and `AI_FALLBACK_TO_SIMULATED=true`, falls back to simulated provider |
| `gemini` | Exclusively calls Gemini. Fails fast at startup if `GEMINI_API_KEY` is missing | If Gemini fails and fallback is enabled, uses simulated; if disabled, throws `503 AI_UNAVAILABLE` (or `503 AI_RATE_LIMITED` on quota 429) |
| `simulated` | Fully local and deterministic. Does not require an API key or internet access | N/A (runs locally) |

#### Fallback Rules:
* When Gemini encounters quota exhaustion (`HTTP 429` / `RESOURCE_EXHAUSTED`), timeouts (`GEMINI_TIMEOUT_MS`), or network errors:
  * If `AI_FALLBACK_TO_SIMULATED=true` (default): Immediately falls back to the deterministic simulated provider, returning HTTP 200 with `fallbackUsed: true` and `provider: "simulated"`.
  * If `AI_FALLBACK_TO_SIMULATED=false`: Returns HTTP `503 AI_RATE_LIMITED` (for quota errors with retry hint) or HTTP `503 AI_UNAVAILABLE`.

---

### 3. Demo Scenarios in Simulated Provider

To facilitate testing and frontend UI demonstrations without a physical camera or vehicle:
* Form parameter `scenario`:
  * `wrong_vehicle`: Simulates reading a mismatched license plate (`ZZZ-999`), triggering HTTP `409 Conflict` (`WRONG_VEHICLE`) with details `{ detected: "ZZZ-999", expected: "XYZ-123" }`.
  * `unreadable`: Simulates an obstructed or blurry plate (`plateDetected: null`), triggering HTTP `422 Unprocessable Entity` (`PLATE_UNREADABLE`).
  * `regression`: Simulates detecting an earlier phase (e.g. `REMOJO` when order is already in `LAVADO`), returning HTTP 200 with `changed: false` and `regression: true` (the system never regresses phase automatically).
  * `low_confidence`: Simulates low confidence score (`phaseConfidence: 0.40`), returning HTTP 200 with `changed: false`.

---

### 4. Verification & Testing via CLI Smoke Script

A standalone smoke test script is provided to verify your Google AI Studio API key and model with a real local photo:

```bash
npm run ai:smoke -- path/to/vehicle.jpg
```
* Loads `.env` securely.
* Passes the image to the AI provider.
* Prints ONLY the structured output, latency, provider, and model name.
* **Secrets Protection:** Sanitizes and suppresses any API key values from output and logs.

> [!CAUTION]
> **Free-Tier Privacy Notice:**
> When using the free tier of Google AI Studio (Gemini API), Google may use input data and prompts to train and improve its models. Do **NOT** submit photographs of real private license plates or identifiable individuals in production without reviewing your Google Cloud / Workspace terms of service.

---

## New Wash Phases, Ready-to-Wash Flow and Bay Lifecycle (Phase 21)

Phase 21 establishes a 5-phase wash workflow, introduces an explicit operator "Ready to Wash" trigger, records an immutable chronological phase audit trail (`PhaseEvent`), enforces automated washing bay lifecycle management, and adds configurable simulation controls.

---

### 1. Wash Phase Catalog & Progress Table

Wash phases are centrally managed in `src/services/simulation.service.js` with Spanish display labels and fixed progress percentages:

| Phase Code | Display Label | Progress | Order | Description |
| :--- | :--- | :---: | :---: | :--- |
| `PENDIENTE` | Pendiente | `10%` | 1 | Initial order state upon creation; car is queued and not yet ready for washing. |
| `REMOJO` | Remojo | `30%` | 2 | Initial soaking, degreasing, and pre-wash rinse cycle. |
| `LAVADO` | Lavando | `55%` | 3 | Active foam shampoo application and mechanical washing. |
| `SECADO` | Secado | `80%` | 4 | Air drying, microfiber towel wipe-down, and finishing. |
| `LISTO` | Listo | `100%` | 5 | Service complete; vehicle is ready for client delivery and bay is automatically freed. |

#### Phase Catalog Endpoint (`GET /api/phases`)
* **Access:** Authenticated (`OPERARIO` or `CLIENTE`).
* **Response (200 OK):**
  ```json
  [
    { "code": "PENDIENTE", "label": "Pendiente", "progress": 10, "order": 1 },
    { "code": "REMOJO", "label": "Remojo", "progress": 30, "order": 2 },
    { "code": "LAVADO", "label": "Lavando", "progress": 55, "order": 3 },
    { "code": "SECADO", "label": "Secado", "progress": 80, "order": 4 },
    { "code": "LISTO", "label": "Listo", "progress": 100, "order": 5 }
  ]
  ```

---

### 2. Operator Workflow: From Vehicle to Finished Wash

The complete operational flow for workshop staff follows 4 steps:

```
[1. POST /api/vehicles]  ──►  [2. POST /api/orders]  ──►  [3. POST /api/orders/:id/ready]  ──►  [4. Phase Progression]
  Register vehicle               Starts PENDIENTE (10%)        Operator marks ready              REMOJO (30%) -> LAVADO (55%) ->
  with plate & owner             Bay marked occupied           Timer starts (readyAt)            SECADO (80%) -> LISTO (100%, bay freed)
```

1. **Register the Vehicle:**
   * Staff registers the vehicle (`POST /api/vehicles`) with plate, make, model, color, and owner.
2. **Create the Service Order:**
   * Staff creates the order (`POST /api/orders`) specifying `vehicleId`, `packageId`, and `bayId`.
   * **Initial State:** Created with `faseActual: "PENDIENTE"`, `porcentajeProgreso: 10`, `listoParaLavar: false`, and `readyAt: null`.
   * **Bay Assignment:** If `bayId` is provided, the target bay is automatically checked and marked `ocupada: true` within the exact same database transaction. Attempting to assign an occupied bay returns HTTP `409 Conflict` (`BAY_OCCUPIED`).
   * **Initial Audit Event:** Automatically records the first `PhaseEvent` (`fase: "PENDIENTE"`, `progreso: 10`, `source: "MANUAL"`).
3. **Trigger "Ready to Wash" (`POST /api/orders/:id/ready`):**
   * When the car is physically positioned in the bay and ready for the wash cycle, the operator calls the ready endpoint.
   * **Role:** `OPERARIO` only (returns `403 Forbidden` for `CLIENTE`).
   * **Updates:** Sets `listoParaLavar: true`, `readyAt: new Date()`, and updates `updatedAt: new Date()`.
   * **Validation Guards:**
     * If already ready (`listoParaLavar: true`) -> returns HTTP `409 Conflict` (`ALREADY_READY`).
     * If not in `PENDIENTE` phase -> returns HTTP `409 Conflict` (`INVALID_STATE`).
     * If order does not exist -> returns HTTP `404 Not Found` (`NOT_FOUND`).
   * **Console Log:** Emits `[READY] Order #<id> marked ready to wash`.
4. **Phase Progression & Completion:**
   * Once ready, the order is eligible for automated background progression (`SIMULATION`), manual technician updates (`MANUAL`), or demo overrides (`DEMO`).
   * Transitioning to `LISTO` (100%) automatically marks the bay `ocupada: false`.

---

### 3. Bay Lifecycle Management

Washing bays are managed transactionally during order lifecycle events:
* **Occupied on Creation:** When `POST /api/orders` assigns a `bayId`, the bay becomes `ocupada: true`.
* **Freed on Completion:** Whenever an order reaches `LISTO` (via `changePhase`), the associated bay is automatically released (`ocupada: false`).
* **Re-occupancy on Reset:** If an order leaves `LISTO` (e.g. `POST /api/orders/:id/simulate/reset` back to `PENDIENTE`), the service attempts to re-occupy the assigned bay:
  * If the bay is currently free -> re-occupies the bay (`ocupada: true`).
  * If the bay has since been taken by another order -> aborts transaction and returns HTTP `409 Conflict` (`BAY_OCCUPIED`).
* **Real-time Occupancy Badge (`GET /api/bays/summary`):** Accurately reflects current bay states (`total`, `occupied`, `free`).

---

### 4. Order Phase Timeline Audit Trail (`GET /api/orders/:id/timeline`)

Every phase change is recorded in an immutable audit table (`PhaseEvent`) with fields:
* `fase`: Canonical phase (`PENDIENTE`, `REMOJO`, `LAVADO`, `SECADO`, `LISTO`).
* `label`: Spanish display label (`Pendiente`, `Remojo`, `Lavando`, `Secado`, `Listo`).
* `progreso`: Progress percentage at the time of the event (`10`, `30`, `55`, `80`, `100`).
* `source`: Origin of the transition (`MANUAL`, `SIMULATION`, `DEMO`, or `AI`).
* `createdAt`: ISO-8601 timestamp when the event occurred.

* **Client Ownership Security:** If an authenticated `CLIENTE` requests the timeline of an order belonging to another customer's vehicle, the API responds with HTTP `404 Not Found` to preserve complete privacy.

---

### 5. Configurable Simulation & Delay Detection (`SIMULATION_AUTO_ADVANCE`)

* **Simulation Guard:** Background auto-advancement only processes orders where `listoParaLavar === true` and `faseActual !== "LISTO"`. Unready `PENDIENTE` orders remain paused indefinitely until an operator activates them.
* **Master Switch (`SIMULATION_AUTO_ADVANCE`):**
  * When `true` (default): Background simulation loop advances eligible orders every interval.
  * When `false`: Scheduler loop executes cleanly without advancing any orders (designed for upcoming AI camera integration).
* **Smart Delay Detection:** Orders resting in `PENDIENTE` that are not yet marked ready are **never** flagged as delayed (`recalculated: false`). Delay recalculation only begins after the operator presses "Ready to Wash".

---

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
| `/api/phases` | `GET` | ❌ | ✅ | ✅ | Wash phase catalog with display labels and progress |
| `/api/orders` | `GET` | ❌ | ✅ (Own) | ✅ (All) | List & filter orders (paginated) |
| `/api/orders/:id` | `GET` | ❌ | ✅ (Own) | ✅ (All) | Order details with bay & package info |
| `/api/orders/:id/timeline` | `GET` | ❌ | ✅ (Own) | ✅ (All) | Chronological phase events audit trail |
| `/api/orders` | `POST` | ❌ | ❌ (403) | ✅ | Create new service order |
| `/api/orders/:id/ready` | `POST` | ❌ | ❌ (403) | ✅ | Mark order ready to wash (OPERARIO only) |
| `/api/orders/:id/analyze` | `POST` | ❌ | ❌ (403) | ✅ | AI camera frame plate & wash phase analysis |
| `/api/orders/:id/analyses` | `GET` | ❌ | ❌ (403) | ✅ | Paginated AI analysis history for order |
| `/api/ai/status` | `GET` | ❌ | ❌ (403) | ✅ | Runtime AI subsystem mode & status probe |
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
| `SIMULATION_AUTO_ADVANCE` | boolean | `true` | When true, simulation automatically advances ready orders. When false, scheduler is idle |
| `GEMINI_API_KEY` | string | Optional | Google AI Studio API key for Gemini multimodal vision |
| `GEMINI_MODEL` | string | `gemini-3.1-flash-lite` | Model identifier for camera frame analysis |
| `AI_MODE` | `auto` \| `gemini` \| `simulated` | `auto` | AI engine mode (auto resolves to Gemini if key is set, else simulated) |
| `AI_FALLBACK_TO_SIMULATED` | boolean | `true` | Fallback to simulated provider when Gemini errors or quota is exhausted |
| `AI_MIN_CONFIDENCE` | number | `0.6` | Minimum confidence threshold (0.0 - 1.0) for plate recognition and wash phase |
| `GEMINI_TIMEOUT_MS` | number | `20000` | Timeout in milliseconds for Gemini API requests |
| `RATE_LIMIT_AI_MAX` | number | `10` | Max requests per IP in window for AI camera frame analysis |

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
  * `fase` (optional enum: `"PENDIENTE" | "REMOJO" | "LAVADO" | "SECADO" | "LISTO"`)
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
   * Click **Execute**. The order is created in initial phase `"PENDIENTE"` with `10%` progress and `listoParaLavar: false`. Note the order `id`.

3. **Mark Ready to Wash (`POST /api/orders/{id}/ready`):**
   * Expand `POST /api/orders/{id}/ready` under **Orders** and click **Try it out**.
   * Enter the order `id` and click **Execute**.
   * The order is marked ready (`listoParaLavar: true`, `readyAt: timestamp`), and the simulation begins tracking the wash.

4. **Advance Phase via Demo Controls (`POST /api/orders/{id}/simulate/advance`):**
   * Expand `POST /api/orders/{id}/simulate/advance` under the **Simulation** tag and click **Try it out**.
   * Enter the order `id` and click **Execute**.
   * The order advances to `"REMOJO"` (`30%`), and subsequent advances move to `"LAVADO"` (`55%`), `"SECADO"` (`80%`), and `"LISTO"` (`100%`).

5. **Upload Photo Evidence (`POST /api/orders/{orderId}/evidence`):**
   * Expand `POST /api/orders/{orderId}/evidence` under the **Evidence** tag and click **Try it out**.
   * Enter the order `id`, choose an image file (JPEG, PNG, or WEBP under 5 MB) via the file picker, and set `etapa` to `"LAVADO"`.
   * Click **Execute** and verify the `201 Created` response with the static image URL.

6. **Track Vehicle with AI Prediction (`GET /api/orders/track/{placa}`):**
   * Expand `GET /api/orders/track/{placa}` under the **Orders** tag and click **Try it out**.
   * Enter plate `"XYZ-123"` and click **Execute**.
   * Inspect the returned payload containing the vehicle, bay, package, current progress, and embedded `prediction`:
     ```json
     {
       "id": 1,
       "faseActual": "LAVADO",
       "porcentajeProgreso": 55,
       "listoParaLavar": true,
       "prediction": {
         "estimatedDeliveryTime": "2026-10-23T17:35:00.000Z",
         "accuracyPercentage": 94,
         "recalculated": false,
         "message": null
       }
     }
     ```

7. **Complete the Order (`POST /api/orders/{id}/simulate/complete`):**
   * Expand `POST /api/orders/{id}/simulate/complete` under **Simulation** and click **Execute**.
   * The order transitions to `"LISTO"` (100% progress) and frees the bay. Checking prediction now yields `accuracyPercentage: 100`.

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
   * `faseActual`: Validated against canonical phases: `"PENDIENTE" | "REMOJO" | "LAVADO" | "SECADO" | "LISTO"`.

3. **Common Route Parameters:**
   * `:id` / `:orderId`: Coerced positive integers. Non-numeric or negative values return `400 Bad Request` with code `"VALIDATION_ERROR"`.
   * `:placa`: Validated against `XXX-123` pattern and normalized to uppercase.

4. **Evidence Uploads (`POST /api/orders/:orderId/evidence`):**
   * Validates `:orderId` parameter before file processing.
   * `etapa`: Optional string validated against canonical phases (`PENDIENTE`, `REMOJO`, `LAVADO`, `SECADO`, `LISTO`).
   * **Orphan File Cleanup:** If Multer persists an uploaded image and subsequent validation fails (such as an invalid `etapa`), the temporary file is immediately removed from disk to avoid orphan artifacts.

---

## Demo Control Endpoints (Phase 12)

Manual override endpoints designed for live presentations and UI testing, allowing operators to force order status changes without waiting for the background simulation timer:

### 1. Force Advance Phase
Advances an active order to its next phase (`PENDIENTE -> REMOJO -> LAVADO -> SECADO -> LISTO`), recalculating progress percentage and resetting the simulation timer.

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
Resets an order back to `faseActual: "PENDIENTE"` and `porcentajeProgreso: 10`, re-occupying the bay if free, and resetting the simulation timer to zero.

* **Endpoint:** `POST /api/orders/:id/simulate/reset`
* **Response:** `200 OK` with updated order object.
* **Console Log:** `[DEMO] Order #<id> reset to PENDIENTE`

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
* **Remaining Time Calculation:** `(remaining phases count) * SIMULATION_PHASE_DURATION_MS`. Reuses canonical sequence `PENDIENTE (4) -> REMOJO (3) -> LAVADO (2) -> SECADO (1) -> LISTO (0)`.
* **Deterministic Accuracy Percentage:** Pseudo-random value between `88` and `97` seeded by the order's ID. Consistent across repeated calls for the same order.
* **Completion Handling:** When `faseActual === "LISTO"`, `estimatedDeliveryTime` returns actual finish time (`updatedAt`), `accuracyPercentage` is `100`, `recalculated` is `false`, and `message` is `null`.
* **Delay Detection:** If elapsed time in current phase exceeds `SIMULATION_PHASE_DURATION_MS`, the order is not in `LISTO`, and `listoParaLavar === true`, flags `recalculated: true` and `message: "Tiempo recalculado por posible retraso"`. Orders that are not yet marked ready (`listoParaLavar: false`) are never flagged as delayed.

---

## Running Tests

Execute the complete test suite (simulation, integration, demo controls, prediction, validation, and error handling):
```bash
npm test
```
