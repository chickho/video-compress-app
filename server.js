const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const path = require("path");
const pLimit = require("p-limit");

const app = express();
const PORT = 3001;
const limit = pLimit(2); // Limit 2 concurrent processes

const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "compressed");

// Ensure output directory exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// Setup multer with renaming
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    const timestamp = Date.now();
    const safeFileName = `${name}-${timestamp}${ext}`;
    cb(null, safeFileName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

let clients = [];

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));
app.use("/compressed", express.static("compressed"));

app.get("/progress", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.push(res);

  req.on("close", () => {
    clients = clients.filter((client) => client !== res);
  });
});

function sendProgress(data) {
  clients.forEach((client) =>
    client.write(`data: ${JSON.stringify(data)}\n\n`)
  );
}

function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      (err, stdout) => {
        if (err) return reject(err);
        resolve(parseFloat(stdout.trim()));
      }
    );
  });
}

function compressAndChromaKey(file, index, format, percent) {
  return new Promise(async (resolve, reject) => {
    try {
      const inputPath = file.path;
      const fileBaseName = path.basename(
        file.filename,
        path.extname(file.filename)
      );
      const outputFileName = `${fileBaseName}-compressed.${format}`;
      const outputPath = path.join(OUTPUT_DIR, outputFileName);

      const originalSizeBytes = fs.statSync(inputPath).size;
      const duration = await getVideoDuration(inputPath);
      const targetSizeBytes = originalSizeBytes * (percent / 100);
      const targetBitrateKbps = Math.floor(
        (targetSizeBytes * 8) / duration / 1000
      );

      let videoCodec = "libx264"; // default for mp4
      let audioCodec = "aac";
      let pixFormat = "yuv420p";

      if (format === "webm") {
        videoCodec = "libvpx-vp9";
        audioCodec = "libopus"; // better for webm
        pixFormat = "yuva420p";
      }

      const ffmpegArgs = [
        "-i",
        inputPath,
        "-vf",
        "chromakey=0x00FF00:0.3:0.1",
        "-c:v",
        videoCodec,
        "-b:v",
        `${targetBitrateKbps}k`,
        "-pix_fmt",
        pixFormat,
        "-c:a",
        audioCodec,
        outputPath,
        "-y",
      ];

      const ffmpeg = spawn("ffmpeg", ffmpegArgs);
      ffmpeg.stderr.setEncoding("utf8");

      ffmpeg.stderr.on("data", (chunk) => {
        const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
          const [, h, m, s] = timeMatch;
          const timeInSeconds = +h * 3600 + +m * 60 + parseFloat(s);
          const progressPercent = ((timeInSeconds / duration) * 100).toFixed(2);

          sendProgress({
            fileIndex: index,
            fileName: file.originalname,
            progress: progressPercent,
          });
        }
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0)
          return reject(new Error(`FFmpeg exited with code ${code}`));

        const result = {
          fileName: file.originalname,
          download: `/compressed/${outputFileName}`,
          originalSize: `${(originalSizeBytes / 1024 / 1024).toFixed(2)} MB`,
          compressedSize: `${(
            fs.statSync(outputPath).size /
            1024 /
            1024
          ).toFixed(2)} MB`,
          percent: `${percent}%`,
        };

        sendProgress({
          ...result,
          fileIndex: index,
          progress: 100,
          done: true,
        });

        // Optional: Cleanup after 10 minutes
        setTimeout(() => {
          fs.unlink(inputPath, () => {});
          fs.unlink(outputPath, () => {});
        }, 10 * 60 * 1000);

        resolve(result);
      });

      ffmpeg.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}

app.post("/upload", upload.array("video"), async (req, res) => {
  const files = req.files;
  const format = req.body.format || "mp4";
  const percent = parseInt(req.body.percent) || 50;

  if (!files || files.length === 0) {
    return res.status(400).send("No files uploaded");
  }

  try {
    const results = await Promise.all(
      files.map((file, index) =>
        limit(() => compressAndChromaKey(file, index, format, percent))
      )
    );
    // === BUAT FILE ZIP ===
    const zipFileName = `compressed-${Date.now()}.zip`;
    const zipFilePath = path.join(OUTPUT_DIR, zipFileName);

    const archiver = require("archiver");
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);

    results.forEach((result) => {
      const filePath = path.join(OUTPUT_DIR, path.basename(result.download));
      archive.file(filePath, { name: path.basename(filePath) });
    });

    await archive.finalize();

    results.push({
      fileName: "Download All",
      download: `/compressed/${zipFileName}`,
      isZip: true,
    });
    console.log(results);
    res.json(results);
  } catch (err) {
    console.error("Processing error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
