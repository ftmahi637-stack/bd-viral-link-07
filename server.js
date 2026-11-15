const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "videos.json");

if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error("Missing required environment variables: ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET");
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");

function readVideos() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return []; }
}
function writeVideos(videos) {
  fs.writeFileSync(DB_FILE, JSON.stringify(videos, null, 2), "utf8");
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Please log in as admin." });
}

app.set("trust proxy", 1);
app.use(express.json());
app.use(session({
  name: "bdvl.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "");
    cb(null, `${crypto.randomUUID()}${ext || ".mp4"}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) return cb(null, true);
    cb(new Error("Please upload a video file."));
  }
});

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/watch/:id", (_req, res) => res.sendFile(path.join(__dirname, "public", "watch.html")));

app.get("/api/videos", (_req, res) => {
  const videos = readVideos().map(v => ({
    id: v.id, title: v.title, description: v.description,
    category: v.category, filename: v.filename, createdAt: v.createdAt
  }));
  res.json(videos.reverse());
});

app.post("/api/login", (req, res, next) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Username or password is incorrect." });
  }
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.isAdmin = true;
    req.session.save(saveErr => {
      if (saveErr) return next(saveErr);
      res.json({ ok: true });
    });
  });
});

app.get("/api/session", (req, res) => res.json({ isAdmin: !!(req.session && req.session.isAdmin) }));
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("bdvl.sid");
    res.json({ ok: true });
  });
});

app.post("/api/upload", requireAdmin, upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a video first." });
  const video = {
    id: crypto.randomUUID(),
    title: String(req.body.title || "Untitled video").trim().slice(0, 120),
    description: String(req.body.description || "").trim().slice(0, 1000),
    category: String(req.body.category || "Other").trim().slice(0, 40),
    filename: req.file.filename,
    createdAt: new Date().toISOString()
  };
  const videos = readVideos();
  videos.push(video);
  writeVideos(videos);
  res.json({ ok: true, video });
});

app.delete("/api/videos/:id", requireAdmin, (req, res) => {
  const videos = readVideos();
  const target = videos.find(v => v.id === req.params.id);
  if (!target) return res.status(404).json({ error: "Video not found." });
  const filePath = path.join(UPLOAD_DIR, path.basename(target.filename));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  writeVideos(videos.filter(v => v.id !== req.params.id));
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Video is too large. Maximum size is 500 MB." });
  }
  res.status(400).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => console.log(`BD VIRAL LINK running on port ${PORT}`));
