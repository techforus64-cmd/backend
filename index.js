// index.js
import express from "express";
import morgan from "morgan";
import cors from "cors";
import dotenv from "dotenv";
import v8 from "v8";
import axios from "axios";
import { AsyncLocalStorage } from "async_hooks";
import { monitorEventLoopDelay } from "perf_hooks";
import { randomUUID } from "crypto";

import connectDatabase from "./db/db.js";
import adminRoute from "./routes/adminRoute.js";
import authRoute from "./routes/authRoute.js";
import transporterRoute from "./routes/transporterRoute.js";
import biddingRoute from "./routes/biddingRoute.js";

// FTL (Wheelseye) vendor routes
import vendorRoute from "./routes/vendorRoute.js";
// Freight Rate routes
import freightRateRoute from "./routes/freightRateRoute.js";
// Wheelseye Pricing routes
import wheelseyePricingRoute from "./routes/wheelseyePricingRoute.js";
// IndiaPost Pricing routes
import indiaPostPricingRoute from "./routes/indiaPostPricingRoute.js";
// ODA routes
import odaRoute from "./routes/odaRoute.js";
// ✅ NEW: Invoice charges routes (import at top)
import invoiceChargesRoutes from './routes/invoiceChargesRoutes.js';
// ✅ NEW: News proxy route (bypass CORS for NewsAPI)
import newsRoute from './routes/newsRoute.js';
// ✅ NEW: Form config route (Form Builder)
import formConfigRoute from './routes/formConfigRoute.js';
// ✅ NEW: Vendor rating route (multi-parameter ratings)
import ratingRoute from './routes/ratingRoute.js';
// ✅ NEW: UTSF routes (Universal Transporter Save Format)
import utsfRoute from './routes/utsfRoute.js';
import utsfService from './services/utsfService.js';
import searchHistoryRoute from './routes/searchHistoryRoute.js';

// Dev-stub routes (ESM imports)
import dashboardRoutes from "./routes/dashboard.js";
import userRoutes from "./routes/users.js";
import userManagementRoute from "./routes/userManagementRoute.js";

dotenv.config();

const app = express();  // ← Create app FIRST
const PORT = process.env.PORT || 8000;

// ───────────────────────── BOOT LOGS & HEALTH METRICS ───────────────────────
console.log(
  `BOOT: starting ${new Date().toISOString()} (node ${process.version}, pid ${process.pid})`
);
const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
console.log(`BOOT: V8 heap limit ~${heapLimitMB} MB (NODE_OPTIONS may affect this)`);

// Event loop lag & memory pulse (helps spot GC pauses / pressure)
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
setInterval(() => {
  const mem = process.memoryUsage();
  const rss = (mem.rss / 1048576).toFixed(0);
  const heapUsed = (mem.heapUsed / 1048576).toFixed(0);
  const p95 = (loop.percentile(95) / 1e6).toFixed(1);
  console.log(`health: rss=${rss}MB heapUsed=${heapUsed}MB heapLimit=${heapLimitMB}MB lag_p95=${p95}ms`);
}, 15000).unref();

// ───────────────────────── REQUEST CONTEXT & TIMING ─────────────────────────
const als = new AsyncLocalStorage();

// Attach per-request id + latency log
app.use((req, res, next) => {
  const id = req.headers["x-request-id"] || randomUUID();
  req.id = id;
  res.setHeader("X-Request-ID", id);

  const start = process.hrtime.bigint();
  als.run({ reqId: id, start }, () => {
    console.log(`[${id}] --> ${req.method} ${req.originalUrl}`);
    res.on("finish", () => {
      const durMs = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`[${id}] <-- ${res.statusCode} ${req.method} ${req.originalUrl} ${durMs.toFixed(1)} ms`);
    });
    next();
  });
});

// Morgan (keep your dev log; plus add ID token if you want)
morgan.token("id", (req) => req.id || "-");
app.use(morgan(":date[iso] :id :method :url :status :res[content-length] - :response-time ms"));

// ────────────────────────────── CORS (with logs) ─────────────────────────────
const STATIC_ALLOWED = [
  // Production
  "https://freight-compare-frontend.vercel.app",
  "https://transporter-signup.netlify.app",
  "https://frontend-six-gamma-72.vercel.app",

  // Development - keep these for local testing
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];
const EXTRA_ALLOWED = (process.env.CLIENT_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...STATIC_ALLOWED, ...EXTRA_ALLOWED]);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) {
        return cb(null, true);
      }
      if (ALLOWED_ORIGINS.has(origin)) {
        console.log(`[CORS] ✓ Allow: ${origin}`);
        return cb(null, true);
      }
      console.log(`[CORS] ✗ Block: ${origin}`);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

// Trust proxy to get correct IP addresses (important for rate limiting)
app.set('trust proxy', 1);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Simple health checks
app.get("/", (_req, res) => res.send("API is running"));
app.get("/health", (_req, res) => res.json({ ok: true }));

// ──────────────────────────── AXIOS TIMING LOGS ──────────────────────────────
function attachAxiosLogging(instance) {
  instance.interceptors.request.use(
    (config) => {
      config.metadata = { start: Date.now() };
      const store = als.getStore();
      if (store?.reqId) {
        config.headers = { ...(config.headers || {}), "x-request-id": store.reqId };
      }
      const rid = store?.reqId || "-";
      console.log(`[${rid}] axios --> ${String(config.method).toUpperCase()} ${config.url}`);
      return config;
    },
    (error) => {
      console.log(`axios request setup error: ${error.message}`);
      return Promise.reject(error);
    }
  );

  instance.interceptors.response.use(
    (res) => {
      const dur = Date.now() - (res.config.metadata?.start || Date.now());
      const rid = als.getStore()?.reqId || "-";
      console.log(`[${rid}] axios <-- ${res.status} ${String(res.config.method).toUpperCase()} ${res.config.url} ${dur}ms`);
      return res;
    },
    (err) => {
      const cfg = err.config || {};
      const dur = cfg.metadata ? Date.now() - cfg.metadata.start : -1;
      const rid = als.getStore()?.reqId || "-";
      const status = err.response?.status || 0;
      console.log(
        `[${rid}] axios ERR ${status} ${String(cfg.method).toUpperCase()} ${cfg.url} after ${dur}ms: ${err.code || err.message}`
      );
      return Promise.reject(err);
    }
  );
}
attachAxiosLogging(axios);
// Ensure axios.create() instances also get the same logging
const _create = axios.create.bind(axios);
axios.create = function (config) {
  const inst = _create(config);
  attachAxiosLogging(inst);
  return inst;
};

// ───────────────────────────── DATABASE CONNECT ──────────────────────────────
console.log("🔌 Connecting to database...");
const dbT0 = Date.now();
connectDatabase()
  .then(async () => {
    console.log(`✅ Database connected successfully in ${Date.now() - dbT0} ms`);
    // Load UTSF transporters from MongoDB (fallback for ephemeral filesystems like Railway)
    const loaded = await utsfService.loadFromMongoDB();
    if (loaded > 0) {
      console.log(`📦 UTSF: Hydrated ${loaded} transporters from MongoDB`);
    }
  })
  .catch((err) => {
    console.error("⚠️ Database connection failed (UTSF mode still available):", err.message || err);
    console.log("📦 Server continuing in UTSF-only mode - MongoDB features will be unavailable");
  });

// ───────────────────────────────── ROUTES ────────────────────────────────────
// Log all transporter API calls
app.use("/api/transporter", (req, res, next) => { console.log(`[API CALL] ${req.method} ${req.url}`); next(); });
app.use("/api/auth", authRoute);
app.use("/api/transporter", transporterRoute);
app.use("/api/admin", adminRoute);
app.use("/api/bidding", biddingRoute);
app.use("/api/vendor", vendorRoute);
app.use("/api/freight-rate", freightRateRoute);
app.use("/api/wheelseye", wheelseyePricingRoute);
app.use("/api/indiapost", indiaPostPricingRoute);
app.use("/api/oda", odaRoute);

// <-- DEV STUBS: add profile + dashboard endpoints (ensure these files exist)
app.use("/api/users", userRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin/management", userManagementRoute);

// ✅ NEW: Register invoice charges routes AFTER app is created
app.use('/api/transporters', invoiceChargesRoutes);
// ✅ NEW: News proxy endpoint (fixes CORS for NewsAPI)
app.use('/api/news', newsRoute);
// ✅ NEW: Form config endpoint (Form Builder)
app.use('/api/form-config', formConfigRoute);
// ✅ NEW: Vendor rating endpoint (multi-parameter ratings)
app.use('/api/ratings', ratingRoute);
// ✅ NEW: UTSF endpoint (Universal Transporter Save Format)
app.use('/api/utsf', utsfRoute);
// ✅ NEW: Search history (Recent Searches - last 7 days, per user)
app.use('/api/search-history', searchHistoryRoute);

// Bulk upload stub
app.post("/upload", async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ success: false, error: "No records provided" });
  }
  try {
    console.log(`[${req.id}] /upload received records: ${records.length}`);
    return res.json({ success: true });
  } catch (err) {
    console.error(`[${req.id}] /upload error:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Global error handler (ensures stack traces are logged once)
app.use((err, req, res, _next) => {
  console.error(`[${req?.id || "-"}] Unhandled error:`, err && err.stack ? err.stack : err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ───────────────────────────── START SERVER ──────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log("📋 Available routes:");
  console.log("  - POST /api/vendor/wheelseye-pricing");
  console.log("  - POST /api/vendor/wheelseye-distance");
  console.log("  - GET  /api/wheelseye/pricing");
  console.log("  - PATCH /api/transporters/:id/invoice-charges"); // ✅ NEW
  console.log("  - GET  /api/transporters/:id/invoice-charges"); // ✅ NEW
  console.log(`==> Available at your primary URL after boot`);
});

// Process-level safety nets
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});
