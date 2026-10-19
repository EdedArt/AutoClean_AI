# AutoClean AI — Backend

Backend REST API for **AutoClean AI** (Node.js + Express + Prisma + SQLite).

## Demo Control Endpoints (Phase 12)

Manual override endpoints designed for live presentations and UI testing, allowing operators to force order status changes without waiting for the background simulation timer:

### 1. Force Advance Phase
Advances an active order to its next phase (`RECIBIDO -> LAVADO -> SECADO -> LISTO`), recalculating progress percentage and resetting the simulation timer.

* **Endpoint:** `POST /api/orders/:id/simulate/advance`
* **Response (Success):** `200 OK` with updated order object.
* **Response (Already Finished):** `400 Bad Request` with `{"error": "Order is already completed."}`.
* **Response (Not Found):** `404 Not Found` with `{"error": "Service order not found"}`.
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
* **Response (Not Found):** `404 Not Found` with `{"error": "Service order not found"}`.
* **Response (Invalid ID):** `400 Bad Request` with `{"error": "Invalid order ID"}`.

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

## Running Tests

Execute the complete test suite (unit, integration, demo controls, and prediction):
```bash
npm test
```
