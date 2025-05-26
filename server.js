const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 500 * 1024 * 1024 },
});

let clients = [];

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

app.post("/upload", upload.single("video"), (req, res) => {
  const inputPath = req.file.path;
  const format = req.body.format || "mp4";
  const percent = parseInt(req.body.percent) || 50;
  const outputPath = `${inputPath}-compressed.${format}`;

  const originalSizeBytes = fs.statSync(inputPath).size;

  exec(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`,
    (err, durationOut) => {
      if (err) return res.status(500).send("Error getting duration");
      const duration = parseFloat(durationOut.trim());
      const targetSizeBytes = originalSizeBytes * (percent / 100);
      const targetBitrate = ((targetSizeBytes * 8) / duration).toFixed(0); // bits/sec
      const targetBitrateKbps = Math.floor(targetBitrate / 1000);

      const codec =
        format === "webm"
          ? "libvpx-vp9"
          : format === "avi"
          ? "mpeg4"
          : format === "mov"
          ? "libx264"
          : "libx264";

      // Spawn ffmpeg process to get live stderr output
      const ffmpegArgs = [
        "-i",
        inputPath,
        "-c:v",
        codec,
        "-b:v",
        `${targetBitrateKbps}k`,
        "-c:a",
        "aac",
        "-strict",
        "-2",
        outputPath,
        "-y",
      ];

      const ffmpeg = spawn("ffmpeg", ffmpegArgs);

      ffmpeg.stderr.setEncoding("utf8");

      ffmpeg.stderr.on("data", (chunk) => {
        // Parse time= from ffmpeg output
        const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const timeInSeconds = hours * 3600 + minutes * 60 + seconds;

          let progressPercent = ((timeInSeconds / duration) * 100).toFixed(2);

          sendProgress({ progress: progressPercent });
        }
      });

      ffmpeg.on("close", (code) => {
        const originalSize =
          (originalSizeBytes / (1024 * 1024)).toFixed(2) + " MB";
        const compressedSize =
          (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2) + " MB";

        sendProgress({
          progress: 100,
          done: true,
          download: `/${outputPath}`,
          originalSize,
          compressedSize,
        });

        res.json({
          download: `/${outputPath}`,
          originalSize,
          compressedSize,
          percent: `${percent}%`,
        });

        setTimeout(() => {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
        }, 10 * 60 * 1000); // 10 menit
      });

      ffmpeg.on("error", (err) => {
        console.error("FFmpeg error:", err);
        res.status(500).send("Compression error");
      });
    }
  );
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
