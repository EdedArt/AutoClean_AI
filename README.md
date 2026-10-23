# AutoClean AI — Backend

Backend REST API for **AutoClean AI** (Node.js + Express + Prisma + SQLite).

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
