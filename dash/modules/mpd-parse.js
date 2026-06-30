import { resolveUrl } from "../../shared/http.js";
import { formatBandwidth } from "../../shared/format.js";

export function parseXml(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "application/xml");
  const parserError = xml.querySelector("parsererror");

  if (parserError) {
    throw new Error("MPD не удалось разобрать как XML.");
  }

  return xml;
}

function getChildElements(element, tagName) {
  if (!element) return [];

  return Array.from(element.children).filter((child) => {
    return child.localName === tagName;
  });
}

function getFirstChildElement(element, tagName) {
  return getChildElements(element, tagName)[0] || null;
}

function getFirstChildText(element, tagName) {
  const child = getFirstChildElement(element, tagName);
  return child ? child.textContent.trim() : null;
}

function getInheritedAttribute(elements, attributeName) {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];

    if (element && element.hasAttribute(attributeName)) {
      return element.getAttribute(attributeName);
    }
  }

  return null;
}

function getInheritedSegmentTemplate(representationElement, adaptationSetElement) {
  return (
    getFirstChildElement(representationElement, "SegmentTemplate") ||
    getFirstChildElement(adaptationSetElement, "SegmentTemplate")
  );
}

function getInheritedSegmentList(representationElement, adaptationSetElement) {
  return (
    getFirstChildElement(representationElement, "SegmentList") ||
    getFirstChildElement(adaptationSetElement, "SegmentList")
  );
}

function getSegmentUrlValue(segmentUrlElement) {
  if (!segmentUrlElement) return null;

  return (
    segmentUrlElement.getAttribute("media") ||
    segmentUrlElement.getAttribute("sourceURL") ||
    null
  );
}

function buildSegmentListData(segmentListElement, baseUrl) {
  if (!segmentListElement) return null;

  const initializationElement = getFirstChildElement(segmentListElement, "Initialization");
  const initializationSourceUrl =
    initializationElement &&
    (
      initializationElement.getAttribute("sourceURL") ||
      initializationElement.getAttribute("sourceUrl")
    );

  const initUrl = initializationSourceUrl
    ? resolveUrl(baseUrl, initializationSourceUrl)
    : null;

  const segmentUrls = getChildElements(segmentListElement, "SegmentURL")
    .map((segmentUrlElement) => {
      const mediaUrl = getSegmentUrlValue(segmentUrlElement);

      if (!mediaUrl) return null;

      return resolveUrl(baseUrl, mediaUrl);
    })
    .filter(Boolean);

  if (segmentUrls.length === 0) {
    throw new Error("SegmentList найден, но внутри нет SegmentURL с media/sourceURL.");
  }

  return {
    initUrl,
    segmentUrls
  };
}

function getCombinedBaseUrl(mpdUrl, mpdElement, periodElement, adaptationSetElement, representationElement) {
  let baseUrl = mpdUrl;

  [
    mpdElement,
    periodElement,
    adaptationSetElement,
    representationElement
  ].forEach((element) => {
    const baseText = getFirstChildText(element, "BaseURL");

    if (baseText) {
      baseUrl = resolveUrl(baseUrl, baseText);
    }
  });

  return baseUrl;
}

export function parseIsoDurationToSeconds(value) {
  if (!value) return null;

  const match = value.match(
    /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
  );

  if (!match) return null;

  const years = Number(match[1] || 0);
  const months = Number(match[2] || 0);
  const days = Number(match[3] || 0);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);

  return (
    years * 365 * 24 * 60 * 60 +
    months * 30 * 24 * 60 * 60 +
    days * 24 * 60 * 60 +
    hours * 60 * 60 +
    minutes * 60 +
    seconds
  );
}

function padNumber(value, width) {
  const text = String(value);

  if (!width) return text;

  return text.padStart(Number(width), "0");
}

function applyTemplate(template, representation, number, time) {
  return template
    .replace(/\$RepresentationID\$/g, representation.id || "")
    .replace(/\$Bandwidth\$/g, String(representation.bandwidth || ""))
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (match, width) => {
      return padNumber(number, width);
    })
    .replace(/\$Time\$/g, String(time ?? ""));
}

function buildTimelineEntries(segmentTimelineElement, startNumber, timescale, mediaDurationSeconds) {
  const entries = [];
  const segmentElements = getChildElements(segmentTimelineElement, "S");

  let currentTime = 0;
  let currentNumber = startNumber;

  for (let index = 0; index < segmentElements.length; index += 1) {
    const segmentElement = segmentElements[index];
    const duration = Number(segmentElement.getAttribute("d"));
    const explicitTime = segmentElement.getAttribute("t");
    const repeat = Number(segmentElement.getAttribute("r") || 0);

    if (!duration) {
      throw new Error("SegmentTimeline содержит сегмент без duration d.");
    }

    if (explicitTime !== null) {
      currentTime = Number(explicitTime);
    }

    let repeatCount = repeat;

    if (repeat < 0) {
      if (!mediaDurationSeconds) {
        throw new Error(
          "SegmentTimeline использует r=-1, но в MPD нет mediaPresentationDuration. Такой dynamic DASH пока не поддерживается."
        );
      }

      const totalUnits = mediaDurationSeconds * timescale;
      repeatCount = Math.max(0, Math.ceil((totalUnits - currentTime) / duration) - 1);
    }

    for (let repeatIndex = 0; repeatIndex <= repeatCount; repeatIndex += 1) {
      entries.push({
        number: currentNumber,
        time: currentTime
      });

      currentNumber += 1;
      currentTime += duration;
    }
  }

  return entries;
}

function buildNumberEntries(startNumber, timescale, duration, mediaDurationSeconds) {
  if (!duration) {
    throw new Error(
      "В SegmentTemplate нет duration. DASH без SegmentTimeline и duration пока не поддерживается."
    );
  }

  if (!mediaDurationSeconds) {
    throw new Error(
      "В MPD нет mediaPresentationDuration. Нельзя посчитать количество DASH-сегментов."
    );
  }

  const segmentCount = Math.ceil((mediaDurationSeconds * timescale) / duration);

  return Array.from({ length: segmentCount }, (_, index) => {
    return {
      number: startNumber + index,
      time: null
    };
  });
}

export function getOutputInfo(representation) {
  const mimeType = representation.mimeType || "";

  if (mimeType.includes("webm")) {
    return {
      extension: ".webm",
      mimeType: "audio/webm"
    };
  }

  if (mimeType.includes("mpeg")) {
    return {
      extension: ".mp3",
      mimeType: "audio/mpeg"
    };
  }

  return {
    extension: ".m4a",
    mimeType: "audio/mp4"
  };
}

export function buildRepresentationLabel(representation, index) {
  const parts = [];

  parts.push(formatBandwidth(representation.bandwidth));

  if (representation.codecs) {
    parts.push(representation.codecs);
  }

  if (representation.mimeType) {
    parts.push(representation.mimeType);
  }

  return `${index + 1}. ${parts.join(" · ")}`;
}

export function parseAudioRepresentations(mpdText, mpdUrl) {
  const xml = parseXml(mpdText);
  const mpdElement = xml.documentElement;

  const mediaDurationSeconds =
    parseIsoDurationToSeconds(mpdElement.getAttribute("mediaPresentationDuration")) ||
    null;

  const periods = getChildElements(mpdElement, "Period");
  const result = [];

  periods.forEach((periodElement, periodIndex) => {
    const periodDurationSeconds =
      parseIsoDurationToSeconds(periodElement.getAttribute("duration")) ||
      mediaDurationSeconds;

    const adaptationSets = getChildElements(periodElement, "AdaptationSet");

    adaptationSets.forEach((adaptationSetElement, adaptationIndex) => {
      const contentType = adaptationSetElement.getAttribute("contentType") || "";
      const adaptationMimeType = adaptationSetElement.getAttribute("mimeType") || "";
      const adaptationCodecs = adaptationSetElement.getAttribute("codecs") || "";

      const isAudio =
        contentType === "audio" ||
        adaptationMimeType.startsWith("audio/") ||
        adaptationCodecs.startsWith("mp4a") ||
        adaptationCodecs.startsWith("opus") ||
        adaptationCodecs.startsWith("vorbis");

      if (!isAudio) return;

      const representations = getChildElements(adaptationSetElement, "Representation");

      representations.forEach((representationElement, representationIndex) => {
        const segmentTemplate = getInheritedSegmentTemplate(
          representationElement,
          adaptationSetElement
        );

        const segmentList = getInheritedSegmentList(
          representationElement,
          adaptationSetElement
        );

        if (!segmentTemplate && !segmentList) {
          return;
        }

        const id =
          representationElement.getAttribute("id") ||
          `audio-${periodIndex}-${adaptationIndex}-${representationIndex}`;

        const bandwidth = Number(
          representationElement.getAttribute("bandwidth") ||
          adaptationSetElement.getAttribute("bandwidth") ||
          0
        );

        const codecs = getInheritedAttribute(
          [mpdElement, periodElement, adaptationSetElement, representationElement],
          "codecs"
        );

        const mimeType = getInheritedAttribute(
          [mpdElement, periodElement, adaptationSetElement, representationElement],
          "mimeType"
        );

        const representation = {
          id,
          bandwidth,
          codecs,
          mimeType,
          periodIndex,
          adaptationIndex,
          representationIndex
        };

        const baseUrl = getCombinedBaseUrl(
          mpdUrl,
          mpdElement,
          periodElement,
          adaptationSetElement,
          representationElement
        );

        let initUrl = null;
        let segmentUrls = [];
        let segmentSource = "unknown";

        if (segmentTemplate) {
          const initializationTemplate = segmentTemplate.getAttribute("initialization");
          const mediaTemplate = segmentTemplate.getAttribute("media");
          const startNumber = Number(segmentTemplate.getAttribute("startNumber") || 1);
          const timescale = Number(segmentTemplate.getAttribute("timescale") || 1);
          const duration = Number(segmentTemplate.getAttribute("duration") || 0);
          const segmentTimeline = getFirstChildElement(segmentTemplate, "SegmentTimeline");

          if (!mediaTemplate) {
            return;
          }

          const entries = segmentTimeline
            ? buildTimelineEntries(segmentTimeline, startNumber, timescale, periodDurationSeconds)
            : buildNumberEntries(startNumber, timescale, duration, periodDurationSeconds);

          initUrl = initializationTemplate
            ? resolveUrl(
                baseUrl,
                applyTemplate(initializationTemplate, representation, startNumber, null)
              )
            : null;

          segmentUrls = entries.map((entry) => {
            return resolveUrl(
              baseUrl,
              applyTemplate(mediaTemplate, representation, entry.number, entry.time)
            );
          });

          segmentSource = segmentTimeline ? "SegmentTemplate + SegmentTimeline" : "SegmentTemplate";
        } else if (segmentList) {
          const segmentListData = buildSegmentListData(segmentList, baseUrl);

          initUrl = segmentListData.initUrl;
          segmentUrls = segmentListData.segmentUrls;
          segmentSource = "SegmentList";
        }

        result.push({
          ...representation,
          initUrl,
          segmentUrls,
          segmentCount: segmentUrls.length,
          segmentSource,
          outputInfo: getOutputInfo(representation)
        });
      });
    });
  });

  result.sort((a, b) => b.bandwidth - a.bandwidth);

  return result;
}
