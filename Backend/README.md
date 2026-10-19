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

## Running Tests

Execute the complete test suite (unit, integration, and demo controls):
```bash
npm test
```
