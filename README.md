# AutoClean AI — Backend

Backend REST API for **AutoClean AI** (Node.js + Express + Prisma + SQLite).

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
