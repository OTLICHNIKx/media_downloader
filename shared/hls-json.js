export function resolveHlsUrl(baseUrl, maybeRelativeUrl) {
  return new URL(maybeRelativeUrl, baseUrl).href;
}

// JSON-unwrap: достаём playlist URL из SoundCloud playback-API ответа.
export function collectHlsJsonStringCandidates(value, path = "", result = []) {
  if (typeof value === "string") {
    result.push({
      value,
      path
    });

    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectHlsJsonStringCandidates(item, `${path}[${index}]`, result);
    });

    return result;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      collectHlsJsonStringCandidates(item, path ? `${path}.${key}` : key, result);
    });
  }

  return result;
}

export function scoreHlsPlaylistCandidate(candidate) {
  const value = String(candidate.value || "").toLowerCase();
  const path = String(candidate.path || "").toLowerCase();

  let score = 0;

  if (path === "url") score += 50;
  if (path.includes("hls")) score += 40;
  if (path.includes("aac")) score += 20;
  if (path.includes("playlist")) score += 20;
  if (path.includes("stream")) score += 10;

  if (value.includes(".m3u8")) score += 100;
  if (value.includes("/playlist")) score += 40;
  if (value.includes("/hls")) score += 30;
  if (value.startsWith("http://") || value.startsWith("https://")) score += 20;

  return score;
}

export function extractHlsPlaylistUrlFromJsonText(text, baseUrl) {
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  const candidates = collectHlsJsonStringCandidates(data)
    .filter((candidate) => {
      const value = String(candidate.value || "").toLowerCase();

      return (
        value.startsWith("http://") ||
        value.startsWith("https://") ||
        value.includes(".m3u8") ||
        value.includes("/playlist") ||
        value.includes("/hls")
      );
    })
    .map((candidate) => {
      return {
        ...candidate,
        score: scoreHlsPlaylistCandidate(candidate)
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return null;
  }

  try {
    return resolveHlsUrl(baseUrl, candidates[0].value);
  } catch {
    return null;
  }
}
