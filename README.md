# AutoClean AI — Backend

[![CI](https://github.com/EdedArt/AutoClean_AI/actions/workflows/ci.yml/badge.svg)](https://github.com/EdedArt/AutoClean_AI/actions/workflows/ci.yml)

Robust, production-ready RESTful backend API and AI vision monitoring engine for **AutoClean AI**, an automated smart vehicle wash management system. AutoClean AI monitors wash cycles in real time, manages physical washing bay allocation, generates realistic completion estimates (ETAs), and analyzes surveillance camera photographs using Google Gemini Vision to automatically detect vehicle license plates and wash phases.

---

## 1. What It Is

AutoClean AI is designed for commercial car wash facilities and their clients:
* **For Operators (`OPERARIO`):** Centralized dashboard control to register incoming vehicles, assign service packages and washing bays, mark orders ready to wash, advance phases manually or through demo simulation triggers, upload photographic wash evidence, analyze camera snapshots via Gemini Vision AI, and formally deliver finished vehicles.
* **For Clients (`CLIENTE`):** Mobile and web accessibility to track vehicle progress in real time via license plate status lookups (`GET /api/plates/:placa/status`), view personal search history, track active orders, and monitor phase progress and estimated completion time (ETA) while guaranteeing privacy (clients never have access to operator photo evidence).

---

## 2. Technology Stack

* **Runtime:** Node.js (v20+ recommended)
* **Framework:** Express.js 4.x
* **Database & ORM:** SQLite with Prisma ORM 5.x
* **Authentication & Security:** JSON Web Tokens (`jsonwebtoken`), `bcryptjs`, `helmet` (HTTP security headers, CORP), `cors` (origin whitelisting), and `express-rate-limit` (layered rate limiting)
* **File Uploads:** Multer (multipart form handling for photo evidence with MIME and size constraints)
* **AI Vision Integration:** Google Gen AI SDK (`@google/genai`) with Gemini 3.1 Flash Lite and deterministic local simulated fallback
* **Validation:** Zod 4.x for environment variables and HTTP request schemas
* **Documentation:** OpenAPI 3.0.3 specification documented in YAML with interactive Swagger UI
* **Testing:** Native Node.js test harness (`node tests/runAll.js`) with custom HTTP clients covering unit, integration, validation, security, and authorization scenarios

---

## 3. Quick Start

### Prerequisites
* Node.js v20+ and npm installed
* Git

### Step-by-Step Setup
1. **Clone the repository:**
   ```bash
   git clone https://github.com/EdedArt/AutoClean_AI.git
   cd AutoClean_AI/Backend
   ```

2. **Install dependencies:**
   ```bash
   npm ci
   ```

3. **Configure environment variables:**
   Copy the example environment configuration template:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` if you wish to configure a real `GEMINI_API_KEY` or custom port. Default settings use local SQLite (`dev.db`), simulated AI provider (`AI_MODE=simulated`), and port 3000.*

4. **Run database migrations:**
   ```bash
   npx prisma migrate deploy
   ```

5. **Seed the database (Demo Accounts):**
   ```bash
   node prisma/seed.js
   ```
   *Seeds default demo accounts: `operario@autoclean.com` and `cliente@autoclean.com` (password: `Demo12345!`), sample bays, and service packages.*

6. **Start the development server:**
   ```bash
   npm run dev
   ```
   The API will be available at `http://localhost:3000`.
   * Health Check: `http://localhost:3000/api/health`
   * Interactive Swagger UI: `http://localhost:3000/api/docs`

7. **Execute test suite:**
   ```bash
   npm test
   ```

---

## 4. Environment Variables

All variables are validated at server startup using Zod schemas (`src/config/env.js`). If any required variable is missing or malformed, the server prints a descriptive error and halts immediately.

| Variable | Type | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | String | *Required* (`file:./dev.db`) | SQLite database file connection string for Prisma. |
| `PORT` | Integer | `3000` | HTTP listening port for the Express application. |
| `NODE_ENV` | String | `development` | Environment mode: `development`, `test`, or `production`. |
| `JWT_SECRET` | String | *Required* (min 32 chars) | Secret key used to sign and verify JSON Web Tokens. |
| `JWT_EXPIRES_IN` | String | `1d` | Token expiration duration (e.g., `1d`, `12h`). |
| `CORS_ORIGINS` | String | `*` | Comma-separated list of allowed origins or `*` to allow all. |
| `RATE_LIMIT_WINDOW_MS` | Integer | `60000` | Rate limiting rolling window in milliseconds (1 minute). |
| `RATE_LIMIT_MAX` | Integer | `100` | Maximum requests per window across general `/api` endpoints. |
| `RATE_LIMIT_EVIDENCE_MAX` | Integer | `20` | Max photo evidence uploads per window across `/api/orders/:id/evidence`. |
| `RATE_LIMIT_AI_MAX` | Integer | `10` | Max camera analysis calls per window across `/api/orders/:id/analyze`. |
| `PLATE_LOOKUP_RATE_LIMIT_PER_MINUTE` | Integer | `30` | Max license plate status lookups per minute per IP / user. |
| `SIMULATION_AUTO_ADVANCE` | Boolean | `true` | Enables or disables background simulation scheduler. |
| `SIMULATION_PHASE_DURATION_MS` | Integer | `60000` | Phase duration for demo auto-advancement (in milliseconds). |
| `AI_MODE` | String | `auto` | AI analysis provider mode: `auto`, `gemini`, or `simulated`. |
| `GEMINI_API_KEY` | String | Optional (`""`) | Google AI Studio API key (required if `AI_MODE=gemini`). |
| `GEMINI_MODEL` | String | `gemini-3.1-flash-lite` | Gemini vision model identifier. |
| `AI_FALLBACK_TO_SIMULATED` | Boolean | `true` | Fallback to simulated provider on Gemini errors (429 quota, timeouts). |
| `AI_MIN_CONFIDENCE` | Float | `0.6` | Minimum confidence threshold (0.0 to 1.0) for detections. |
| `GEMINI_TIMEOUT_MS` | Integer | `20000` | Timeout in milliseconds for Google Gemini requests. |
| `PHASE_ETA_MINUTES` | JSON String | Optional | JSON string overriding default wash phase minutes for realistic ETA. |

---

## 5. Roles & Permissions Matrix

AutoClean AI enforces role-based access control (RBAC) across two roles:
* **`OPERARIO` (Staff / Operator):** Full operational management over bays, vehicles, orders, photo evidences, AI camera audits, demo simulation triggers, and deliveries.
* **`CLIENTE` (Vehicle Owner / Customer):** Read-only visibility strictly restricted to own vehicles, active orders, and personal plate search history. **Clients are strictly forbidden from viewing or uploading photographic evidence.**

| Endpoint | Method | Public | CLIENTE | OPERARIO | Notes |
|---|---|:---:|:---:|:---:|---|
| `/api/health` | GET | ✔ | ✔ | ✔ | Service liveness probe |
| `/api/docs` & `/api/docs.json` | GET | ✔ | ✔ | ✔ | Interactive Swagger UI and OpenAPI schema |
| `/api/auth/register` | POST | ✔ | ✔ | ✔ | Register new customer or operator |
| `/api/auth/login` | POST | ✔ | ✔ | ✔ | Authenticate credentials & receive JWT |
| `/api/auth/me` | GET | ❌ | ✔ | ✔ | Retrieve current authenticated user profile |
| `/api/plates/:placa/status` | GET | ❌ | ✔ | ✔ | Minimal status view; logs history for CLIENTE |
| `/api/me/plates` | GET | ❌ | ✔ | ❌ (403) | Retrieve customer search history (max 10) |
| `/api/me/plates/:placa` | DELETE | ❌ | ✔ | ❌ (403) | Remove plate from customer search history |
| `/api/orders/track/:placa` | GET | ❌ | ✔ (Own only) | ✔ | Active order tracking with ETA |
| `/api/orders` | GET | ❌ | ✔ (Own only) | ✔ (All) | Filter by status, plate, phase, bay |
| `/api/orders/:id/timeline` | GET | ❌ | ✔ (Own only) | ✔ | Chronological phase events and delivery audit |
| `/api/orders/:id/prediction` | GET | ❌ | ✔ (Own only) | ✔ | Completion prediction analytics |
| `/api/vehicles` | GET | ❌ | ✔ (Own only) | ✔ (All) | List registered vehicles |
| `/api/vehicles/:id` | GET | ❌ | ✔ (Own only) | ✔ | Vehicle details |
| `/api/orders` | POST | ❌ | ❌ (403) | ✔ | Create new order (enforces 1 active/plate) |
| `/api/orders/:id/ready` | POST | ❌ | ❌ (403) | ✔ | Mark order ready to wash (`listoParaLavar`) |
| `/api/orders/:id/phase` | PATCH | ❌ | ❌ (403) | ✔ | Manually update order phase |
| `/api/orders/:id/deliver` | POST | ❌ | ❌ (403) | ✔ | Deliver completed vehicle (race-safe) |
| `/api/orders/:id/evidence` | GET, POST | ❌ | ❌ (403) | ✔ | Evidence photos restricted to operators |
| `/api/orders/:id/analyze` | POST | ❌ | ❌ (403) | ✔ | AI Vision plate detection & phase transition |
| `/api/orders/:id/analyses` | GET | ❌ | ❌ (403) | ✔ | Audit log of AI analysis executions |
| `/api/ai/status` | GET | ❌ | ❌ (403) | ✔ | Operational status of AI engine |
| `/api/orders/:id/simulate/*` | POST | ❌ | ❌ (403) | ✔ | Demo controls (`advance`, `reset`, `complete`) |
| `/api/vehicles` | POST | ❌ | ❌ (403) | ✔ | Register vehicle into the system |
| `/api/vehicles/:id/owner` | PATCH | ❌ | ❌ (403) | ✔ | Transfer vehicle ownership |
| `/api/bays` & `/api/bays/summary` | GET | ❌ | ❌ (403) | ✔ | Washing bay availability & assignments |
| `/api/packages` | GET | ❌ | ❌ (403) | ✔ | Wash service packages |
| `/evidence/:filename` | GET | ✔* | ✔* | ✔* | Direct static asset access via unguessable URL |

*\* Evidence files are served with unguessable random names. See Section 9 for privacy details.*

---

## 6. Endpoint Reference

All endpoints return JSON responses. Every authenticated endpoint requires an HTTP header:
`Authorization: Bearer <JWT_TOKEN>`

### Authentication
* `POST /api/auth/register`: Create account (`email`, `password`, `nombre`, `rol`: `"CLIENTE"` or `"OPERARIO"`).
* `POST /api/auth/login`: Authenticate (`email`, `password`) and receive signed JWT.
* `GET /api/auth/me`: Profile information of the currently authenticated token.

### Vehicles
* `GET /api/vehicles`: List vehicles (paginated with `page`, `limit`, search by `placa`).
* `POST /api/vehicles`: Register vehicle (`placa`, `marca`, `modelo`, optional `color`, optional `ownerEmail` or `ownerId`, optional `nivelSuciedad`).
* `GET /api/vehicles/:id`: Fetch vehicle by database ID.
* `PATCH /api/vehicles/:id/owner`: Reassign vehicle owner (`ownerEmail` or `ownerId`).

### Orders & Tracking
* `GET /api/orders`: List orders with pagination envelopes (`page`, `limit`, `placa`, `fase`, `bayId`, `active=true|false`).
* `POST /api/orders`: Create wash order (`vehicleId`, optional `packageId`, optional `bayId`). Fails if vehicle already has an active order (`409 ACTIVE_ORDER_EXISTS`).
* `POST /api/orders/:id/ready`: Mark order ready to begin washing (`listoParaLavar: true`).
* `PATCH /api/orders/:id/phase`: Manually transition wash phase (`faseActual`).
* `GET /api/orders/:id/timeline`: Chronological log of phase transitions and delivery timestamp.
* `GET /api/orders/:id/prediction`: Machine learning/heuristic delivery time prediction.
* `GET /api/orders/track/:placa`: Active order tracking for a license plate. Returns 404 `"No hay un carro lavándose con esta placa"` if no active order exists or if requested by a non-owner client.

### Delivery
* `POST /api/orders/:id/deliver`: Atomically marks order delivered (`deliveredAt = now`).
  * Requires order to be in `faseActual = 'LISTO'`.
  * Race-safe: concurrent attempts result in exactly one `200 OK` and subsequent `409 ALREADY_DELIVERED`.
  * Locks order against any further phase modifications, AI analyses, or demo triggers.

### Plate Lookup & Search History
* `GET /api/plates/:placa/status`: Public minimal view for any authenticated user. Normalizes license plates (e.g., `abc123` -> `ABC-123`). If queried by `CLIENTE`, automatically upserts into customer's search history.
  ```json
  {
    "placa": "ABC-123",
    "marca": "Toyota",
    "modelo": "Corolla",
    "color": "Blanco",
    "fase": "LAVADO",
    "porcentajeProgreso": 55,
    "listoParaLavar": true,
    "startedAt": "2026-10-24T18:00:00.000Z",
    "receivedAt": "2026-10-24T17:45:00.000Z",
    "etaMinutes": 20,
    "etaLabel": "Aprox. 20 min",
    "estimatedReadyAt": "2026-10-24T18:35:00.000Z"
  }
  ```
* `GET /api/me/plates`: Search history for current `CLIENTE` (max 10, ordered by `lastSearchedAt` descending), enriched with live status.
* `DELETE /api/me/plates/:placa`: Remove specific plate from customer's search history (`204 No Content`).

### Evidence (Staff Only)
* `POST /api/orders/:id/evidence`: Upload photo evidence (`image` multipart file, `etapa`: `REMOJO`, `LAVADO`, `SECADO`, or `LISTO`).
* `GET /api/orders/:id/evidence`: List all evidence images attached to the order.

### AI Camera Analysis
* `POST /api/orders/:id/analyze`: Upload bay surveillance image (`image` field). Runs OCR plate verification and phase classification. If detected plate matches order and detected phase advances forward, automatically advances order phase with audit source `"AI"`.
* `GET /api/orders/:id/analyses`: Paginated history of AI analysis attempts for the order.
* `GET /api/ai/status`: Health and configuration status of the AI vision provider.

### Demo Controls (Staff Only)
* `POST /api/orders/:id/simulate/advance`: Force immediate advancement to next phase.
* `POST /api/orders/:id/simulate/reset`: Reset order back to `PENDIENTE` (10%).
* `POST /api/orders/:id/simulate/complete`: Force order directly to `LISTO` (100%).

### Bays, Packages & System
* `GET /api/bays`: List washing bays with current occupancy status.
* `GET /api/bays/summary`: Summary of total, occupied, and free washing bays.
* `GET /api/packages`: List available wash service packages.
* `GET /api/health`: Health probe reporting server uptime and timestamp.
* `GET /api/docs`: Interactive Swagger UI documentation.
* `GET /api/docs.json`: Raw OpenAPI 3.0.3 specification in JSON format.

---

## 7. Wash Phases & Realistic ETA

### Standard Wash Phases
The wash cycle follows a deterministic progression:
1. **`PENDIENTE` (10%):** Order created. Vehicle is waiting in reception. Washing bay is reserved. Order must be marked as ready (`POST /api/orders/:id/ready`) before washing can begin.
2. **`REMOJO` (30%):** Pre-wash and initial soak.
3. **`LAVADO` (55%):** Active shampoo and mechanical/manual scrub.
4. **`SECADO` (80%):** Rinse, blower drying, and microfiber detail.
5. **`LISTO` (100%):** Wash cycle completed. **Washing bay is automatically freed** for other vehicles. Vehicle waits in the delivery area.

### Realistic ETA Estimation
Estimated Time of Arrival (ETA) is calculated independently from the demo simulation clock:
* **Default Phase Durations:**
  * `PENDIENTE`: 10 min
  * `REMOJO`: 5 min
  * `LAVADO`: 15 min
  * `SECADO`: 10 min
  * `LISTO`: 0 min
  * `QUEUE_WAIT_PER_ORDER`: 15 min per earlier unfinished order (capped at 120 min)
* **Elapsed Deduction:** The calculation deducts elapsed minutes in the current phase (referenced against latest phase transition timestamp).
* **Guarantees:** Remaining time never drops below 1 minute until `LISTO` (which returns 0 min with label `"Listo para entregar"`).
* **Formatting:**
  * Less than 60 min: `"Aprox. 25 min"`
  * Exact hours: `"Aprox. 1 h"` or `"Aprox. 2 h"`
  * Hours and minutes: `"Aprox. 1 h 30 min"`
  * Unready with queue: `"Pendiente, aprox. 1 h 15 min"`

---

## 8. One Active Order & Delivery Business Rules

1. **Active Order Definition:** An order is active if and only if `deliveredAt === null`.
2. **Single Active Order Concurrency:** A vehicle license plate can have **at most one active order** across the entire database. If an operator attempts to create a new order while an active order exists, the request is rejected with `409 Conflict` (`ACTIVE_ORDER_EXISTS`).
3. **Delivery Event:**
   * Delivery is a business milestone, **not** a wash phase. The order stays in `LISTO`.
   * Only orders in `faseActual = 'LISTO'` can be delivered. Attempting delivery on earlier phases throws `409 NOT_FINISHED`.
   * Upon delivery, `deliveredAt` is timestamped.
   * Concurrent delivery requests are handled atomically: exactly one succeeds with `200 OK`, while parallel calls fail with `409 ALREADY_DELIVERED`.
4. **Post-Delivery Restrictions:** Once delivered, orders are immutable. Any attempt to update phase, trigger demo simulation, or run AI analysis returns `409 ALREADY_DELIVERED`.
5. **Re-ordering:** Once delivered, a new order for the same vehicle license plate can be created immediately.

---

## 9. Privacy & Evidence Isolation

AutoClean AI enforces strict data privacy rules regarding client-facing information:
* **Photos Are Operator-Only:** Customers (`CLIENTE`) are **never** permitted to access photographic evidence (`GET /api/orders/:id/evidence` and `POST /api/orders/:id/evidence` return `403 FORBIDDEN`).
* **Minimal Plate Status View:** `GET /api/plates/:placa/status` exposes only essential vehicle metadata and progress indicators (`placa`, `marca`, `modelo`, `color`, `fase`, `porcentajeProgreso`, `listoParaLavar`, `startedAt`, `receivedAt`, `etaMinutes`, `etaLabel`, `estimatedReadyAt`). It never leaks internal bay IDs, operator notes, or owner identities.
* **Unguessable Static URLs (Known Architecture Limitation):** Evidence images stored in `storage/evidence/` are served statically at `/evidence/:filename` with Cross-Origin Resource Policy headers (`cross-origin`). Files are given unguessable, cryptographically random names (timestamp + high-entropy suffix). However, anyone with the exact direct URL can fetch the file; strict authenticated token gating for raw binary files is a planned enhancement for future releases.

---

## 10. Centralized Error Codes Table

The backend implements a unified error response contract:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

| HTTP Status | Error Code | Description / Trigger Scenario |
|:---:|---|---|
| **400** | `VALIDATION_ERROR` | Request payload, query parameters, or route params failed Zod validation schema. |
| **400** | `INVALID_ID` | Route parameter ID is not a valid integer. |
| **400** | `INVALID_PHASE` | Specified phase string is not one of `PENDIENTE`, `REMOJO`, `LAVADO`, `SECADO`, `LISTO`. |
| **400** | `INVALID_OWNER` | Designated vehicle owner does not possess the `CLIENTE` role. |
| **400** | `INVALID_FILE_TYPE` | Uploaded file MIME type is not allowed (only JPEG, PNG, WEBP, JFIF permitted). |
| **400** | `FILE_MISSING` | Required multipart form-data file was not attached in request. |
| **400** | `FILE_UPLOAD_ERROR` | Multer encountered an unexpected parsing or boundary error. |
| **400** | `INVALID_JSON` | Malformed JSON in request body. |
| **400** | `INVALID_REFERENCE` | Prisma foreign key constraint violation (referenced entity does not exist). |
| **400** | `ORDER_COMPLETED` | Demo control attempted to advance an order already in `LISTO`. |
| **401** | `UNAUTHORIZED` | Missing, expired, or malformed JWT token in `Authorization` header. |
| **401** | `INVALID_CREDENTIALS`| Incorrect email or password during login attempt. |
| **403** | `FORBIDDEN` | Authenticated user role does not have authorization to perform this action. |
| **404** | `NOT_FOUND` | Requested database record (vehicle, order, package, bay, history item) was not found. |
| **404** | `OWNER_NOT_FOUND` | User email or ID specified for vehicle ownership does not exist. |
| **404** | `ROUTE_NOT_FOUND` | Requested HTTP route and method combination does not exist. |
| **409** | `DUPLICATE_RESOURCE` | Unique constraint violation (e.g. duplicate user email or vehicle plate). |
| **409** | `ACTIVE_ORDER_EXISTS` | Vehicle license plate already has an unfinished/undelivered active service order. |
| **409** | `ALREADY_DELIVERED` | Attempted delivery or modification of an order that has already been delivered. |
| **409** | `NOT_FINISHED` | Attempted delivery of an order that has not yet reached the `LISTO` phase. |
| **409** | `BAY_OCCUPIED` | Designated washing bay is currently occupied by another active order. |
| **409** | `ALREADY_READY` | Order has already been marked ready to wash (`listoParaLavar: true`). |
| **409** | `NOT_READY` | AI camera analysis attempted on an order that is not yet ready to wash. |
| **409** | `INVALID_STATE` | Order state invalid for requested transition (e.g., mark ready from non-PENDIENTE). |
| **409** | `WRONG_VEHICLE` | AI analysis detected a license plate differing from the order's registered vehicle. |
| **413** | `PAYLOAD_TOO_LARGE` | JSON request payload exceeds 100 KB limit. |
| **413** | `FILE_TOO_LARGE` | Uploaded image exceeds 5 MB limit. |
| **422** | `PLATE_UNREADABLE` | AI Vision could not detect a legible license plate with sufficient confidence. |
| **429** | `RATE_LIMITED` | Request quota exceeded for global, evidence, AI, or plate lookup rate limiters. |
| **500** | `INTERNAL_ERROR` | Unhandled server error. Stack trace suppressed in production. |
| **503** | `AI_UNAVAILABLE` | Gemini API request failed (timeout or network error) and fallback is disabled. |
| **503** | `AI_RATE_LIMITED` | Gemini free tier API quota exceeded (HTTP 429) and fallback is disabled. |

> **Note on Generic Error Codes:** The codes `BAD_REQUEST` (400), `CONFLICT` (409), and `UNPROCESSABLE_ENTITY` (422) are generic fallback codes defined in `AppError` helper defaults, but are not emitted by current endpoints (current endpoints always emit specific domain codes).

---

## 11. AI Vision Integration & Calibration Rules

### Vision Architecture
AutoClean AI connects surveillance cameras in washing bays to Google Gemini Vision (`gemini-3.1-flash-lite` via `@google/genai`). The system operates in three configurable modes (`AI_MODE`):
1. **`gemini`:** Real API calls to Google AI Studio. Fails if `GEMINI_API_KEY` is missing.
2. **`simulated`:** Local deterministic provider for automated testing, development, and offline operation. Reads scenario cues from filenames (e.g. `car-XYZ-123.jpg`, `wrong-plate.jpg`, `unreadable.jpg`).
3. **`auto`:** Uses Google Gemini if `GEMINI_API_KEY` is present; otherwise falls back gracefully to simulated mode.

### Fallback Behavior
When `AI_FALLBACK_TO_SIMULATED=true`, any runtime failure from Google Gemini (such as free-tier rate limits `429 Too Many Requests`, socket timeouts, or transient network drops) automatically routes the request to the simulated provider so demo operations and testing remain uninterrupted.

### Context-Aware Phase Calibration
AutoClean AI **monitors car wash progression; it does NOT audit wash quality**. Surveillance cameras frequently observe wet paint, foam remnants, or water droplets on clean vehicles. The AI decision engine combines visual observations with the order's historical backend state:
* If current phase is `SECADO` and the AI observes a clean, dry vehicle, it transitions to `LISTO` and frees the washing bay.
* If current phase is `PENDIENTE`, observing a clean vehicle will **never** skip intermediate wash phases to jump to `LISTO`.
* Backward regressions (e.g. observing water during `SECADO`) are safely ignored to prevent state oscillation.

> [!NOTE]
> **Free Tier Privacy Notice:** When utilizing the Google Gemini API free tier, prompt and image inputs may be reviewed by human annotators per Google terms of service. For commercial deployment with customer vehicles, a paid enterprise tier or vertex AI agreement must be utilized.

---

## 12. Automated Test Suites

The backend includes 16 standalone test suites executed via `npm test` (`node tests/runAll.js`):

| # | Test Suite | File | Focus Areas |
|:---:|---|---|---|
| 1 | Simulation Engine | `tests/simulation.test.js` | Phase mapping, progress increments, automatic tick advancing |
| 2 | End-to-End Integration | `tests/integration.test.js` | Full lifecycle creation, phase flow, and bay occupancy |
| 3 | Demo Controls | `tests/demoControls.test.js` | Force advance, reset, and force complete |
| 4 | Delivery Prediction | `tests/prediction.test.js` | Estimated completion analytics, bay delay detection |
| 5 | Request Validation | `tests/validation.test.js` | Zod schema validation across query, body, and params |
| 6 | Error Handling | `tests/errorHandling.test.js` | Unified error format, status codes, stack trace hiding |
| 7 | Search & Pagination | `tests/searchFilters.test.js` | Filter by plate, phase, bay; pagination envelopes |
| 8 | OpenAPI / Swagger | `tests/openapi.test.js` | 100% route coverage parity between Express routes & Swagger |
| 9 | Basic Security & Config | `tests/security.test.js` | Zod env parsing, Helmet headers, CORS, body size limits |
| 10 | Authentication & Roles | `tests/auth.test.js` | Registration, login, password hashing, JWT authorization |
| 11 | Ownership & Privacy | `tests/ownership.test.js` | Client data isolation, vehicle ownership reassignment |
| 12 | Phases & Ready Flow | `tests/phasesFlow.test.js` | `listoParaLavar` gate, bay release on LISTO, audit events |
| 13 | AI Vision & Provider | `tests/aiAnalysis.test.js` | Gemini vision, plate OCR, quota fallback, analyses audit |
| 14 | Context Phase Rules | `tests/phaseRules.test.js` | Context-aware phase rules, regression suppression |
| 15 | Delivery & Realistic ETA | `tests/delivery.test.js` | Delivery event, race safety, 1 active order per plate, ETA |
| 16 | Plate Status Lookup | `tests/plateLookup.test.js` | Minimal plate view, customer search history, photo privacy |

---

## 13. Project Structure

```
Backend/
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI workflow (Node 20, tests)
├── docs/
│   └── openapi.yaml             # OpenAPI 3.0.3 specification
├── prisma/
│   ├── migrations/              # Versioned database migrations
│   ├── schema.prisma            # Prisma schema (User, Vehicle, Order, Bay, Event, Evidence, AI)
│   └── seed.js                  # Initial database seeder (Demo accounts & bays)
├── src/
│   ├── config/
│   │   ├── db.js                # Prisma database client instance
│   │   ├── env.js               # Zod environment schema & startup validation
│   │   └── swagger.js           # Swagger UI specification loader
│   ├── controllers/
│   │   ├── ai.controller.js            # AI analysis & status endpoints
│   │   ├── auth.controller.js          # Authentication (login, register, me)
│   │   ├── bay.controller.js           # Bay occupancy & assignments
│   │   ├── evidence.controller.js      # Evidence upload & listing (staff only)
│   │   ├── me.controller.js            # Customer search history endpoints
│   │   ├── package.controller.js       # Wash package catalog
│   │   ├── plate.controller.js         # Public plate lookup endpoint
│   │   ├── serviceOrder.controller.js  # Order lifecycle, delivery, timeline, tracking
│   │   └── vehicle.controller.js       # Vehicle registration & ownership
│   ├── middlewares/
│   │   ├── auth.middleware.js          # JWT authentication & RBAC authorization
│   │   ├── error.middleware.js         # Centralized error handler & 404 handler
│   │   ├── rateLimit.middleware.js     # Rate limiters (global, evidence, AI, plate)
│   │   ├── upload.middleware.js        # Multer disk upload configuration
│   │   └── validate.middleware.js      # Zod request validation middleware
│   ├── routes/                         # Express route definitions
│   ├── services/
│   │   ├── ai/                         # Gemini provider, simulated provider, calibration
│   │   ├── eta.service.js              # Realistic ETA computation engine
│   │   ├── orderPhase.service.js       # Phase transition business logic & audit
│   │   ├── plateView.service.js        # Shared minimal plate view formatter
│   │   ├── prediction.service.js       # Predictive delivery analytics
│   │   └── simulation.service.js       # Background auto-advancement simulation
│   ├── utils/                          # AppError, asyncHandler, ownership helpers
│   └── validators/                     # Zod request schemas
├── storage/
│   └── evidence/                # Disk directory for stored evidence photos
├── tests/                       # 16 test suites & test runner
├── server.js                    # Express application entrypoint
├── package.json                 # Project dependencies & scripts
└── .env.example                 # Template for environment configuration
```

---

## 14. Mobile Compatibility Notes

The AutoClean AI backend is built to interface directly with mobile client applications (React Native, Flutter, Swift, Kotlin):
1. **Strict JSON API:** All API endpoints produce consistent JSON payloads with explicit HTTP status codes.
2. **ISO 8601 Timestamps:** All dates and timestamps (`createdAt`, `readyAt`, `deliveredAt`, `estimatedReadyAt`, `lastSearchedAt`) are serialized in ISO 8601 UTC format (e.g. `2026-10-24T18:00:00.000Z`).
3. **Bearer Token Authentication:** Standard `Authorization: Bearer <token>` header is used. Mobile apps should persist this token securely in `Keychain` (iOS) or `EncryptedSharedPreferences` / `Keystore` (Android).
4. **Standard Pagination Envelope:** Endpoints returning collections (`/api/orders`, `/api/vehicles`, `/api/orders/:id/analyses`) return structured pagination metadata:
   ```json
   {
     "data": [],
     "pagination": {
       "page": 1,
       "limit": 10,
       "total": 42,
       "totalPages": 5,
       "hasNextPage": true,
       "hasPrevPage": false
     }
   }
   ```
5. **Unified Error Contract:** Mobile apps should intercept errors using `error.code` for localized UI alerting rather than parsing error message strings.
6. **AI Analysis Latency:** Processing bay surveillance photos via Google Gemini Vision (`POST /api/orders/:id/analyze`) can require between 10 to 35 seconds depending on network latency and image resolution. Mobile applications should display an indeterminate loading spinner or perform uploads via background tasks.

---

## 15. Known Limitations

1. **Static Evidence Access Control:** Photo evidence files stored in `storage/evidence/` are served statically over HTTP using unguessable random hashes. While customer roles cannot list or query evidence through API endpoints, knowing the exact filename allows direct download. Strict token-protected streaming for static files is recommended for enterprise hardening.
2. **SQLite Concurrency:** SQLite is ideal for local development, demo environments, and edge server nodes. High-volume concurrent production instances should migrate Prisma datasource to PostgreSQL.
3. **In-Memory Rate Limiting:** Rate limiters use an in-memory counter store. In a multi-instance cluster deployment, configure Redis store backing for `express-rate-limit`.
