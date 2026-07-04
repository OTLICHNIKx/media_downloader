// Локальная mp3-конвертация через vendor ffmpeg.
// MVP: HLS-only, lazy-loaded, ESM wrapper + local core assets.

const ESM_BASE = "vendor/ffmpeg/esm";
const CORE_BASE = "vendor/ffmpeg/core";
let ffmpegModulePromise = null;
let ffmpegInstancePromise = null;

function getVendorUrl(basePath, filename) {
  return chrome.runtime.getURL(`${basePath}/${filename}`);
}

function ensureRuntimeApi() {
  if (!globalThis.chrome?.runtime?.getURL) {
    throw new Error("chrome.runtime.getURL недоступен для загрузки ffmpeg vendor assets.");
  }
}

async function importFfmpegModule() {
  ensureRuntimeApi();

  if (!ffmpegModulePromise) {
    ffmpegModulePromise = import(getVendorUrl(ESM_BASE, "index.js")).catch((error) => {
      ffmpegModulePromise = null;
      throw error;
    });
  }

  return ffmpegModulePromise;
}

async function createFfmpegInstance(onLog = null) {
  const ffmpegModule = await importFfmpegModule();
  const FFmpegCtor = ffmpegModule.FFmpeg || ffmpegModule.default?.FFmpeg || ffmpegModule.default;

  if (typeof FFmpegCtor !== "function") {
    throw new Error("Не найден конструктор FFmpeg в vendor/ffmpeg/esm/index.js.");
  }

  const ffmpeg = new FFmpegCtor();

  if (typeof onLog === "function" && typeof ffmpeg.on === "function") {
    ffmpeg.on("log", ({ message }) => {
      onLog(String(message || ""));
    });
  }

  await ffmpeg.load({
    classWorkerURL: getVendorUrl(ESM_BASE, "worker.js"),
    coreURL: getVendorUrl(CORE_BASE, "ffmpeg-core.js"),
    wasmURL: getVendorUrl(CORE_BASE, "ffmpeg-core.wasm")
  });

  return ffmpeg;
}

export async function ensureMp3TranscoderLoaded(options = {}) {
  if (!ffmpegInstancePromise) {
    ffmpegInstancePromise = createFfmpegInstance(options.onLog).catch((error) => {
      ffmpegInstancePromise = null;
      throw error;
    });
  }

  return ffmpegInstancePromise;
}

export function canTranscodeToMp3(outputInfo = null) {
  if (!outputInfo) return false;

  const extension = String(outputInfo.extension || "").toLowerCase();
  const mimeType = String(outputInfo.mimeType || "").toLowerCase();

  return (
    mimeType.startsWith("audio/") ||
    [".m4a", ".aac", ".mp3", ".mp4"].includes(extension)
  );
}

function replaceFileExtension(filename, extension) {
  const cleanName = String(filename || "media.m4a").trim();

  if (/\.[a-z0-9]{2,5}$/i.test(cleanName)) {
    return cleanName.replace(/\.[a-z0-9]{2,5}$/i, extension);
  }

  return `${cleanName}${extension}`;
}

export async function transcodeAudioBlobToMp3(inputBlob, filename, options = {}) {
  if (!(inputBlob instanceof Blob)) {
    throw new Error("Для mp3-конвертации нужен Blob входного файла.");
  }

  const ffmpeg = await ensureMp3TranscoderLoaded({ onLog: options.onLog });
  const inputExtension = String(options.inputExtension || ".m4a").replace(/^\.?/, ".");
  const inputFilename = `input${inputExtension}`;
  const outputFilename = replaceFileExtension(filename || "media.m4a", ".mp3");
  const outputFsName = "output.mp3";

  const inputBytes = new Uint8Array(await inputBlob.arrayBuffer());

  await ffmpeg.writeFile(inputFilename, inputBytes);
  await ffmpeg.exec([
    // -loglevel error: отсечь info/verbose-лог, который гоняется из
    // wasm-воркера через postMessage и создаёт ненужный overhead.
    "-loglevel",
    "error",
    "-threads",
    // libmp3lame однопоточный; в wasm дополнительные треды почти не дают
    // выигрыша на коротком аудио, но добавляют overhead на синхронизации.
    "1",
    "-i",
    inputFilename,
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    String(options.quality || 2),
    outputFsName
  ]);

  const outputData = await ffmpeg.readFile(outputFsName);
  const outputBytes = outputData instanceof Uint8Array
    ? outputData
    : new Uint8Array(outputData.buffer || outputData);

  if (typeof ffmpeg.deleteFile === "function") {
    try {
      await ffmpeg.deleteFile(inputFilename);
      await ffmpeg.deleteFile(outputFsName);
    } catch {
      // best-effort cleanup
    }
  }

  return {
    blob: new Blob([outputBytes.buffer], { type: "audio/mpeg" }),
    filename: outputFilename
  };
}
