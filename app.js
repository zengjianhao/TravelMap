const TDT_KEY = "a4a2856a7780c55db70d6d9622fb69e7";
const CHINA_GB = "156000000";
const PROGRESS_STORAGE_KEY = "travel-map-progress-v1";
const CHINA_BOUNDS = [
  [3.408477, 73.498962],
  [53.558498, 135.087387]
];
const RESET_VIEW_PADDING = [18, 18];
const ADMINISTRATIVE_VIEW_PADDING = [8, 8];
const MAX_ZOOM_OFFSET = 5;
const BASE_MIN_ZOOM = 0;
const BASE_MAX_ZOOM = 18;
const API_BASE = "https://cloudcenter.tianditu.gov.cn/api/portal";
const MENU_URL = `${API_BASE}/region/menu`;
const SHOW_TDT_REFERENCE_BORDER = false;
const BLANK_TILE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const STROKE_ZOOM_EXPONENT = 0.6;
const EXPORT_IMAGE_SCALE = 8;
const EXPORT_CROP_PADDING = 18;
const EXPORT_CONTENT_THRESHOLD = 252;
const BASE_STROKE_WEIGHTS = {
  county: 0.3,
  city: 0.4,
  province: 0.78
};
const COVERED_COUNTY_FILL = "#800f2f";
const COVERED_CITY_FILL = "#ff4d6d";
const COVERED_PROVINCE_FILL = "#ffb3c1";
const COVERED_COUNTY_FILL_OPACITY = 0.86;
const COVERED_CITY_FILL_OPACITY = 0.68;
const COVERED_PROVINCE_FILL_OPACITY = 0.46;

const countyStyle = {
  color: "#ced4da",
  fill: true,
  fillColor: "#ced4da",
  fillOpacity: 0,
  interactive: true,
  opacity: 1,
  weight: BASE_STROKE_WEIGHTS.county
};

const cityStyle = {
  color: "#495057",
  fill: true,
  fillColor: "#495057",
  fillOpacity: 0,
  interactive: true,
  opacity: 1,
  weight: BASE_STROKE_WEIGHTS.city
};

const provinceStyle = {
  color: "#184e77",
  fill: true,
  fillColor: "#184e77",
  fillOpacity: 0,
  interactive: true,
  opacity: 1,
  weight: BASE_STROKE_WEIGHTS.province
};

const adminRenderer = L.svg({ padding: 0.35 });

const map = L.map("map", {
  attributionControl: false,
  boxZoom: false,
  keyboard: false,
  maxZoom: BASE_MAX_ZOOM,
  minZoom: BASE_MIN_ZOOM,
  preferCanvas: false,
  renderer: adminRenderer,
  wheelPxPerZoomLevel: 80,
  zoomAnimationThreshold: 8,
  zoomDelta: 0.5,
  zoomControl: false,
  zoomSnap: 0.1
});

map.createPane("coveragePane");
map.getPane("coveragePane").style.pointerEvents = "none";
map.getPane("coveragePane").style.zIndex = 625;
map.getPane("tooltipPane").style.zIndex = 760;

const coverageRenderer = L.svg({ pane: "coveragePane", padding: 0.35 });

let baseStrokeZoom = null;
let activeCityGb = null;
let activeCityName = null;
let activeProvinceGb = null;
let activeProvinceName = null;
let hoverRestoreHandler = null;
let hoverRestoreTimer = null;
let isHoverSuppressed = false;
const provinceCityGbsByGb = new Map();
const provinceCountyGbsByGb = new Map();
const provinceDirectCountyGbsByGb = new Map();
const cityParentProvinceGbByGb = new Map();
const cityCountyGbsByGb = new Map();
const countyParentCityGbByGb = new Map();
const countyParentProvinceGbByGb = new Map();
const coveredCountyGbs = new Set();
const coveredCityGbs = new Set();
const coveredProvinceGbs = new Set();
let resetBounds = L.latLngBounds(CHINA_BOUNDS);

const zoomInButton = document.querySelector("#zoom-in");
const zoomOutButton = document.querySelector("#zoom-out");
const upLevelButton = document.querySelector("#up-level-map");
const clearCoverageButton = document.querySelector("#clear-coverage");
const downloadImageButton = document.querySelector("#download-image");
const mapFrame = document.querySelector("#map-frame");
const mapPath = document.querySelector("#map-path");

function updateCoverageControls() {
  clearCoverageButton.disabled = coveredCountyGbs.size === 0;
}

function updateHierarchyNavigationControl() {
  upLevelButton.disabled = !activeProvinceGb && !activeCityGb;
}

function updateMapPath() {
  const parts = ["中国"];
  if (activeProvinceName) parts.push(activeProvinceName);
  if (activeCityName) parts.push(activeCityName);

  mapPath.replaceChildren();
  parts.forEach((part, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "map-path-separator";
      separator.textContent = "/";
      mapPath.append(separator);
    }

    const item = document.createElement("span");
    item.className = "map-path-item";
    item.textContent = part;
    if (index === parts.length - 1) {
      item.setAttribute("aria-current", "page");
    }
    mapPath.append(item);
  });
  updateHierarchyNavigationControl();
}

function updateZoomControls() {
  const zoom = map.getZoom();
  zoomOutButton.disabled = zoom <= map.getMinZoom() + 0.001;
  zoomInButton.disabled = zoom >= map.getMaxZoom() - 0.001;
}

function applyZoomLimits(bounds = resetBounds, padding = RESET_VIEW_PADDING) {
  const minZoom = getUnboundedBoundsZoom(bounds, padding);
  // Avoid setMinZoom/setMaxZoom here because they clamp the current view
  // before the map can recenter for the new administrative level.
  map.options.minZoom = minZoom;
  map.options.maxZoom = minZoom + MAX_ZOOM_OFFSET;
  map.fire("zoomlevelschange");
  return minZoom;
}

function getUnboundedBoundsZoom(bounds, padding) {
  const currentMinZoom = map.options.minZoom;
  const currentMaxZoom = map.options.maxZoom;
  map.options.minZoom = BASE_MIN_ZOOM;
  map.options.maxZoom = BASE_MAX_ZOOM;
  try {
    return map.getBoundsZoom(bounds, false, padding);
  } finally {
    map.options.minZoom = currentMinZoom;
    map.options.maxZoom = currentMaxZoom;
  }
}

function setBoundedView(bounds, padding) {
  map.stop();
  applyZoomLimits(bounds, padding);
  map.fitBounds(bounds, {
    animate: false,
    padding
  });
  updateZoomControls();
}

function setResetView() {
  setBoundedView(resetBounds, RESET_VIEW_PADDING);
}

function clearProvinceSelection() {
  if (!activeProvinceGb && !activeCityGb) return;
  activeCityGb = null;
  activeCityName = null;
  activeProvinceGb = null;
  activeProvinceName = null;
  isHoverSuppressed = false;
  closeAdministrativeTooltips();
  updateMapPath();
  refreshAdministrativeStyles();
}

function fitAdministrativeLayer(layer) {
  const bounds = layer.getBounds();
  if (suppressHoverDuringViewChange(bounds)) {
    setBoundedView(bounds, ADMINISTRATIVE_VIEW_PADDING);
  }
}

function moveUpHierarchyLevel() {
  if (activeCityGb) {
    activeCityGb = null;
    activeCityName = null;
    updateMapPath();
    refreshAdministrativeStyles();
    saveProgress();

    const activeProvinceLayer = findLayerByGb(provinceLayer, activeProvinceGb);
    if (activeProvinceLayer) fitAdministrativeLayer(activeProvinceLayer);
    return;
  }

  if (activeProvinceGb) {
    clearProvinceSelection();
    setResetView();
    saveProgress();
  }
}

updateMapPath();
setResetView();

zoomInButton.addEventListener("click", event => {
  event.currentTarget.blur();
  map.zoomIn();
});

zoomOutButton.addEventListener("click", event => {
  event.currentTarget.blur();
  map.zoomOut();
});

upLevelButton.addEventListener("click", event => {
  event.currentTarget.blur();
  moveUpHierarchyLevel();
});

clearCoverageButton.addEventListener("click", event => {
  event.currentTarget.blur();
  clearCoverage();
});

downloadImageButton.addEventListener("click", event => {
  event.currentTarget.blur();
  downloadCurrentViewImage();
});

map.on("zoomend zoomlevelschange resize", updateZoomControls);

const tdtBorderLayer = L.tileLayer(
  `https://t{s}.tianditu.gov.cn/DataServer?T=ibo_w&x={x}&y={y}&l={z}&tk=${TDT_KEY}`,
  {
    errorTileUrl: BLANK_TILE,
    maxNativeZoom: 10,
    maxZoom: 10,
    minNativeZoom: 3,
    minZoom: 3,
    opacity: 0.18,
    subdomains: "01234567",
    zIndex: 1
  }
);

function getFeatureGb(feature) {
  return (feature.properties && feature.properties.gb) || "";
}

function getFeatureName(feature) {
  return (feature.properties && feature.properties.name) || "";
}

function getBoundaryScale() {
  const zoomScale = baseStrokeZoom === null ? 1 : map.getZoomScale(map.getZoom(), baseStrokeZoom);
  return zoomScale ** STROKE_ZOOM_EXPONENT;
}

function getScaledBoundaryWeight(level) {
  return BASE_STROKE_WEIGHTS[level] * getBoundaryScale();
}

function isFeatureVisibleInActiveProvince(feature, level) {
  const gb = getFeatureGb(feature);

  if (activeCityGb) {
    if (level === "province") return false;
    if (level === "city") return gb === activeCityGb;

    const allowedCountyGbs = cityCountyGbsByGb.get(activeCityGb);
    return Boolean(allowedCountyGbs && allowedCountyGbs.has(gb));
  }

  if (!activeProvinceGb) return true;
  if (level === "province") return gb === activeProvinceGb;

  const allowedGbs = level === "city"
    ? provinceCityGbsByGb.get(activeProvinceGb)
    : provinceCountyGbsByGb.get(activeProvinceGb);

  return Boolean(allowedGbs && allowedGbs.has(gb));
}

function getBoundaryStyle(baseStyle, level, feature) {
  const visible = isFeatureVisibleInActiveProvince(feature, level);
  const style = {
    ...baseStyle,
    opacity: visible ? baseStyle.opacity : 0,
    weight: getScaledBoundaryWeight(level)
  };

  if ("fillOpacity" in baseStyle) {
    style.fillOpacity = visible ? baseStyle.fillOpacity : 0;
  }

  return style;
}

function isCountyCovered(feature) {
  return coveredCountyGbs.has(getFeatureGb(feature));
}

function isCityCovered(feature) {
  return coveredCityGbs.has(getFeatureGb(feature));
}

function isProvinceCovered(feature) {
  return coveredProvinceGbs.has(getFeatureGb(feature));
}

function isCityInCoveredProvince(feature) {
  const provinceGb = cityParentProvinceGbByGb.get(getFeatureGb(feature));
  return Boolean(provinceGb && coveredProvinceGbs.has(provinceGb));
}

function isDirectCountyInCoveredProvince(feature) {
  const countyGb = getFeatureGb(feature);
  const provinceGb = countyParentProvinceGbByGb.get(countyGb);
  return Boolean(
    provinceGb &&
      coveredProvinceGbs.has(provinceGb) &&
      countyParentCityGbByGb.get(countyGb) === provinceGb
  );
}

function applyCoverageFill(style, fillColor, fillOpacity) {
  return {
    ...style,
    fillColor,
    fillOpacity: style.opacity ? fillOpacity : 0
  };
}

function getCountyStyle(feature) {
  const style = getBoundaryStyle(countyStyle, "county", feature);
  return isCountyCovered(feature)
    ? { ...style, fillOpacity: 0 }
    : style;
}

function getCityStyle(feature) {
  const style = getBoundaryStyle(cityStyle, "city", feature);
  if (isCityCovered(feature)) {
    return applyCoverageFill(style, COVERED_CITY_FILL, COVERED_CITY_FILL_OPACITY);
  }

  return isCityInCoveredProvince(feature)
    ? applyCoverageFill(style, COVERED_PROVINCE_FILL, COVERED_PROVINCE_FILL_OPACITY)
    : style;
}

function getProvinceStyle(feature) {
  const style = getBoundaryStyle(provinceStyle, "province", feature);
  return isProvinceCovered(feature)
    ? applyCoverageFill(style, COVERED_PROVINCE_FILL, COVERED_PROVINCE_FILL_OPACITY)
    : style;
}

function updateProvinceInteractivity() {
  provinceLayer.eachLayer(layer => {
    const element = layer.getElement();
    if (element) {
      const canInteract = !activeProvinceGb && isFeatureVisibleInActiveProvince(layer.feature, "province");
      element.style.pointerEvents = canInteract ? "auto" : "none";
    }
  });
}

function updateCityInteractivity() {
  cityLayer.eachLayer(layer => {
    const element = layer.getElement();
    if (element) {
      const canInteract = Boolean(
        activeProvinceGb &&
          !activeCityGb &&
          isFeatureVisibleInActiveProvince(layer.feature, "city")
      );
      element.style.pointerEvents = canInteract ? "auto" : "none";
    }
  });
}

function canInteractWithCounty(feature) {
  if (!isFeatureVisibleInActiveProvince(feature, "county")) return false;
  if (activeCityGb) return true;
  if (!activeProvinceGb) return false;

  const directCountyGbs = provinceDirectCountyGbsByGb.get(activeProvinceGb);
  return Boolean(directCountyGbs && directCountyGbs.has(getFeatureGb(feature)));
}

function canShowCountyTooltip(feature) {
  return !isHoverSuppressed && canInteractWithCounty(feature);
}

function updateCountyInteractivity() {
  countyLayer.eachLayer(layer => {
    const element = layer.getElement();
    if (element) {
      element.style.pointerEvents = canInteractWithCounty(layer.feature) ? "auto" : "none";
    }
  });
}

function getCoverageOverlayStyle(feature) {
  const visible = isFeatureVisibleInActiveProvince(feature, "county");
  const covered = isCountyCovered(feature);
  const directCountyInCoveredProvince = isDirectCountyInCoveredProvince(feature);
  const fillColor = covered ? COVERED_COUNTY_FILL : COVERED_PROVINCE_FILL;
  const fillOpacity = covered ? COVERED_COUNTY_FILL_OPACITY : COVERED_PROVINCE_FILL_OPACITY;

  return {
    color: fillColor,
    fill: true,
    fillColor,
    fillOpacity: visible && (covered || directCountyInCoveredProvince) ? fillOpacity : 0,
    interactive: false,
    opacity: 0,
    weight: 0
  };
}

function refreshCoverageOverlay() {
  coverageLayer.setStyle(getCoverageOverlayStyle);
}

function refreshAdministrativeStyles() {
  countyLayer.setStyle(getCountyStyle);
  cityLayer.setStyle(getCityStyle);
  provinceLayer.setStyle(getProvinceStyle);
  refreshCoverageOverlay();
  updateCountyInteractivity();
  updateCityInteractivity();
  updateProvinceInteractivity();
}

function closeAdministrativeTooltips() {
  countyLayer.eachLayer(layer => {
    layer.closeTooltip();
  });
  cityLayer.eachLayer(layer => {
    layer.closeTooltip();
  });
  provinceLayer.eachLayer(layer => {
    layer.closeTooltip();
  });
}

function closeLayerGroupTooltips(layerGroup, activeLayer) {
  layerGroup.eachLayer(layer => {
    if (layer !== activeLayer) {
      layer.closeTooltip();
    }
  });
}

function restoreHoverAfterViewChange() {
  if (hoverRestoreHandler !== null) {
    map.off("moveend", hoverRestoreHandler);
    hoverRestoreHandler = null;
  }

  if (hoverRestoreTimer !== null) {
    window.clearTimeout(hoverRestoreTimer);
    hoverRestoreTimer = null;
  }
  isHoverSuppressed = false;
  closeAdministrativeTooltips();
}

function suppressHoverDuringViewChange(bounds) {
  if (hoverRestoreHandler !== null) {
    map.off("moveend", hoverRestoreHandler);
    hoverRestoreHandler = null;
  }

  if (hoverRestoreTimer !== null) {
    window.clearTimeout(hoverRestoreTimer);
    hoverRestoreTimer = null;
  }

  isHoverSuppressed = true;
  closeAdministrativeTooltips();

  if (!bounds.isValid()) {
    restoreHoverAfterViewChange();
    return false;
  }

  const restoreHover = () => {
    hoverRestoreHandler = null;
    window.setTimeout(restoreHoverAfterViewChange, 80);
  };

  hoverRestoreHandler = restoreHover;
  map.once("moveend", hoverRestoreHandler);
  hoverRestoreTimer = window.setTimeout(() => {
    restoreHoverAfterViewChange();
  }, 1200);

  return true;
}

function updateCoveredAdministrativeAreas() {
  coveredCityGbs.clear();
  coveredProvinceGbs.clear();
  coveredCountyGbs.forEach(countyGb => {
    const cityGb = countyParentCityGbByGb.get(countyGb);
    if (cityGb) coveredCityGbs.add(cityGb);
    const provinceGb = countyParentProvinceGbByGb.get(countyGb);
    if (provinceGb) coveredProvinceGbs.add(provinceGb);
  });
}

function getProgressSnapshot() {
  return {
    activeCityGb,
    activeCityName,
    activeProvinceGb,
    activeProvinceName,
    coveredCountyGbs: Array.from(coveredCountyGbs),
    version: 1
  };
}

function readStoredProgress() {
  try {
    const rawProgress = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!rawProgress) return null;

    const progress = JSON.parse(rawProgress);
    if (!progress || progress.version !== 1) return null;

    return {
      activeCityGb: typeof progress.activeCityGb === "string" ? progress.activeCityGb : null,
      activeCityName: typeof progress.activeCityName === "string" ? progress.activeCityName : null,
      activeProvinceGb: typeof progress.activeProvinceGb === "string" ? progress.activeProvinceGb : null,
      activeProvinceName: typeof progress.activeProvinceName === "string" ? progress.activeProvinceName : null,
      coveredCountyGbs: Array.isArray(progress.coveredCountyGbs)
        ? progress.coveredCountyGbs.filter(gb => typeof gb === "string")
        : []
    };
  } catch (error) {
    console.warn("Failed to read saved progress.", error);
    return null;
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(getProgressSnapshot()));
  } catch (error) {
    console.warn("Failed to save progress.", error);
  }
}

function findLayerByGb(layerGroup, gb) {
  let matchedLayer = null;
  layerGroup.eachLayer(layer => {
    if (!matchedLayer && getFeatureGb(layer.feature) === gb) {
      matchedLayer = layer;
    }
  });
  return matchedLayer;
}

function restoreSavedProgress() {
  const progress = readStoredProgress();
  if (!progress) return false;

  coveredCountyGbs.clear();
  progress.coveredCountyGbs.forEach(countyGb => {
    if (countyParentCityGbByGb.has(countyGb)) {
      coveredCountyGbs.add(countyGb);
    }
  });

  const provinceLayerToRestore = progress.activeProvinceGb
    ? findLayerByGb(provinceLayer, progress.activeProvinceGb)
    : null;
  const cityLayerToRestore = progress.activeCityGb
    ? findLayerByGb(cityLayer, progress.activeCityGb)
    : null;

  activeProvinceGb = provinceLayerToRestore ? getFeatureGb(provinceLayerToRestore.feature) : null;
  activeProvinceName = provinceLayerToRestore
    ? getFeatureName(provinceLayerToRestore.feature) || progress.activeProvinceName
    : null;
  activeCityGb = activeProvinceGb && cityLayerToRestore ? getFeatureGb(cityLayerToRestore.feature) : null;
  activeCityName = activeCityGb
    ? getFeatureName(cityLayerToRestore.feature) || progress.activeCityName
    : null;

  updateCoveredAdministrativeAreas();
  updateCoverageControls();
  updateMapPath();
  refreshAdministrativeStyles();

  const layerToRestore = cityLayerToRestore || provinceLayerToRestore;
  if (layerToRestore) {
    const boundsToRestore = layerToRestore.getBounds();
    setBoundedView(boundsToRestore, ADMINISTRATIVE_VIEW_PADDING);
  }

  return true;
}

function setCountyCoverage(feature, isCovered) {
  const countyGb = getFeatureGb(feature);
  if (!countyGb) return;

  if (isCovered) {
    coveredCountyGbs.add(countyGb);
  } else {
    coveredCountyGbs.delete(countyGb);
  }

  updateCoveredAdministrativeAreas();
  updateCoverageControls();
  refreshAdministrativeStyles();
  saveProgress();
}

function toggleCountyCoverage(feature) {
  setCountyCoverage(feature, !isCountyCovered(feature));
}

function clearCoverage() {
  if (!coveredCountyGbs.size) return;
  coveredCountyGbs.clear();
  updateCoveredAdministrativeAreas();
  updateCoverageControls();
  refreshAdministrativeStyles();
  saveProgress();
}

function waitForNextPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function getCurrentPathText() {
  return ["中国", activeProvinceName, activeCityName].filter(Boolean).join("-");
}

function getImageFileName() {
  const pathText = getCurrentPathText()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const today = new Date().toISOString().slice(0, 10);
  return `travel-map-${pathText}-${today}.png`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function canvasToBlob(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(resolve, "image/png");
  });
}

function loadSvgImage(svgMarkup) {
  const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();

  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => {
      URL.revokeObjectURL(url);
      resolve(image);
    }, { once: true });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to render map SVG."));
    }, { once: true });
    image.src = url;
  });
}

function getExportStyle(styleFn, scale) {
  return feature => {
    const style = styleFn(feature);
    return {
      ...style,
      interactive: false,
      weight: style.weight * scale
    };
  };
}

function getVisibleExportGeoJson(sourceLayer, level) {
  const geoJson = sourceLayer.toGeoJSON();
  return {
    ...geoJson,
    features: (geoJson.features || []).filter(feature => isFeatureVisibleInActiveProvince(feature, level))
  };
}

function addExportLayer(exportMap, exportRenderer, sourceLayer, level, styleFn, scale) {
  return L.geoJSON(getVisibleExportGeoJson(sourceLayer, level), {
    interactive: false,
    renderer: exportRenderer,
    smoothFactor: 0,
    style: getExportStyle(styleFn, scale)
  }).addTo(exportMap);
}

function getCurrentAdministrativeBounds() {
  if (activeCityGb) {
    const activeCityLayer = findLayerByGb(cityLayer, activeCityGb);
    if (activeCityLayer) return activeCityLayer.getBounds();
  }

  if (activeProvinceGb) {
    const activeProvinceLayer = findLayerByGb(provinceLayer, activeProvinceGb);
    if (activeProvinceLayer) return activeProvinceLayer.getBounds();
  }

  return resetBounds;
}

async function renderExportMapSvg(width, height, scale) {
  const container = document.createElement("div");
  container.style.height = `${height}px`;
  container.style.left = "-100000px";
  container.style.opacity = "0";
  container.style.pointerEvents = "none";
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.width = `${width}px`;
  document.body.append(container);

  const exportRenderer = L.svg({ padding: 0.35 });
  const exportMap = L.map(container, {
    attributionControl: false,
    boxZoom: false,
    fadeAnimation: false,
    keyboard: false,
    maxZoom: 24,
    minZoom: 0,
    preferCanvas: false,
    renderer: exportRenderer,
    zoomAnimation: false,
    zoomControl: false,
    zoomSnap: 0.1
  });

  try {
    exportMap.fitBounds(getCurrentAdministrativeBounds(), {
      animate: false,
      padding: [8 * scale, 8 * scale]
    });

    addExportLayer(exportMap, exportRenderer, countyLayer, "county", getCountyStyle, scale);
    addExportLayer(exportMap, exportRenderer, cityLayer, "city", getCityStyle, scale);
    addExportLayer(exportMap, exportRenderer, provinceLayer, "province", getProvinceStyle, scale);
    addExportLayer(exportMap, exportRenderer, coverageLayer, "county", getCoverageOverlayStyle, scale);

    await waitForNextPaint();

    const svg = container.querySelector("svg");
    if (!svg) throw new Error("Export map SVG was not rendered.");

    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", width);
    clone.setAttribute("height", height);
    clone.removeAttribute("style");

    return new XMLSerializer().serializeToString(clone);
  } finally {
    exportMap.remove();
    container.remove();
  }
}

function drawMapPath(ctx, width, height) {
  const parts = ["中国", activeProvinceName, activeCityName].filter(Boolean);
  const tokens = parts.flatMap((part, index) => {
    const item = {
      color: index === parts.length - 1 ? "#344054" : "#748196",
      text: part
    };

    return index === 0
      ? [item]
      : [{ color: "#98a2b3", text: " / " }, item];
  });

  ctx.font = "500 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textBaseline = "bottom";

  let x = width - 20;
  const y = height - 18;
  [...tokens].reverse().forEach(token => {
    const textWidth = ctx.measureText(token.text).width;
    x -= textWidth;
    ctx.fillStyle = token.color;
    ctx.fillText(token.text, x, y);
  });
}

function isExportContentPixel(data, index) {
  if (data[index + 3] < 8) return false;

  return (
    data[index] < EXPORT_CONTENT_THRESHOLD ||
    data[index + 1] < EXPORT_CONTENT_THRESHOLD ||
    data[index + 2] < EXPORT_CONTENT_THRESHOLD
  );
}

function getCanvasContentBounds(canvas) {
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!isExportContentPixel(data, index)) continue;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return maxX === -1
    ? null
    : { minX, minY, maxX, maxY };
}

function cropCanvasToContent(canvas, scale) {
  const bounds = getCanvasContentBounds(canvas);
  if (!bounds) return canvas;

  const padding = Math.round(EXPORT_CROP_PADDING * scale);
  const sourceX = Math.max(0, bounds.minX - padding);
  const sourceY = Math.max(0, bounds.minY - padding);
  const sourceRight = Math.min(canvas.width, bounds.maxX + padding + 1);
  const sourceBottom = Math.min(canvas.height, bounds.maxY + padding + 1);
  const width = sourceRight - sourceX;
  const height = sourceBottom - sourceY;
  const croppedCanvas = document.createElement("canvas");
  const croppedCtx = croppedCanvas.getContext("2d");

  croppedCanvas.width = width;
  croppedCanvas.height = height;
  croppedCtx.fillStyle = "#ffffff";
  croppedCtx.fillRect(0, 0, width, height);
  croppedCtx.drawImage(canvas, sourceX, sourceY, width, height, 0, 0, width, height);

  return croppedCanvas;
}

function drawExportFrame(canvas, scale) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width / scale;
  const height = canvas.height / scale;

  ctx.save();
  ctx.scale(scale, scale);
  drawMapPath(ctx, width, height);
  ctx.strokeStyle = "#d8dde3";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.restore();
}

async function renderCurrentViewCanvas() {
  const frameRect = mapFrame.getBoundingClientRect();
  const scale = EXPORT_IMAGE_SCALE;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = Math.round(frameRect.width * scale);
  canvas.height = Math.round(frameRect.height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, frameRect.width, frameRect.height);

  const exportSvgMarkup = await renderExportMapSvg(canvas.width, canvas.height, scale);
  const exportMapImage = await loadSvgImage(exportSvgMarkup);
  ctx.drawImage(exportMapImage, 0, 0, frameRect.width, frameRect.height);

  const croppedCanvas = cropCanvasToContent(canvas, scale);
  drawExportFrame(croppedCanvas, scale);

  return croppedCanvas;
}

async function downloadCurrentViewImage() {
  closeAdministrativeTooltips();
  downloadImageButton.disabled = true;

  try {
    await waitForNextPaint();
    const canvas = await renderCurrentViewCanvas();
    const blob = await canvasToBlob(canvas);
    if (blob) {
      downloadBlob(blob, getImageFileName());
    }
  } finally {
    downloadImageButton.disabled = false;
  }
}

function enterProvince(layer) {
  const provinceGb = getFeatureGb(layer.feature);
  if (!provinceGb) return;

  activeCityGb = null;
  activeCityName = null;
  activeProvinceGb = provinceGb;
  activeProvinceName = getFeatureName(layer.feature);
  updateMapPath();
  refreshAdministrativeStyles();
  saveProgress();

  const provinceBounds = layer.getBounds();
  if (suppressHoverDuringViewChange(provinceBounds)) {
    setBoundedView(provinceBounds, ADMINISTRATIVE_VIEW_PADDING);
  }
}

function enterCity(layer) {
  const cityGb = getFeatureGb(layer.feature);
  if (!cityGb) return;

  activeCityGb = cityGb;
  activeCityName = getFeatureName(layer.feature);
  updateMapPath();
  refreshAdministrativeStyles();
  saveProgress();

  const cityBounds = layer.getBounds();
  if (suppressHoverDuringViewChange(cityBounds)) {
    setBoundedView(cityBounds, ADMINISTRATIVE_VIEW_PADDING);
  }
}

function setupCountyInteractions(feature, layer) {
  const countyName = getFeatureName(feature);
  if (countyName) {
    layer.bindTooltip(countyName, {
      className: "admin-tooltip",
      direction: "top",
      sticky: true
    });
  }

  layer.on({
    click: () => {
      if (isHoverSuppressed || !canInteractWithCounty(feature)) return;
      toggleCountyCoverage(feature);
    },
    mouseout: () => {
      layer.setStyle(getCountyStyle(feature));
    },
    mouseover: () => {
      if (!canShowCountyTooltip(feature)) {
        layer.closeTooltip();
        return;
      }
      layer.openTooltip();
    },
    tooltipopen: () => {
      if (!canShowCountyTooltip(feature)) {
        layer.closeTooltip();
      }
    }
  });
}

const countyLayer = L.geoJSON(null, {
  interactive: true,
  onEachFeature: setupCountyInteractions,
  pane: "overlayPane",
  renderer: adminRenderer,
  smoothFactor: 0,
  style: getCountyStyle
}).addTo(map);

const coverageLayer = L.geoJSON(null, {
  interactive: false,
  pane: "coveragePane",
  renderer: coverageRenderer,
  smoothFactor: 0,
  style: getCoverageOverlayStyle
}).addTo(map);

function setupCityInteractions(feature, layer) {
  const cityName = getFeatureName(feature);
  if (cityName) {
    layer.bindTooltip(cityName, {
      className: "admin-tooltip",
      direction: "top",
      sticky: true
    });
  }

  layer.on({
    click: () => {
      if (!activeProvinceGb || activeCityGb) return;
      enterCity(layer);
    },
    mouseout: () => {
      layer.closeTooltip();
      layer.setStyle(getCityStyle(feature));
    },
    mouseover: () => {
      if (isHoverSuppressed || !activeProvinceGb || activeCityGb || !isFeatureVisibleInActiveProvince(feature, "city")) {
        layer.closeTooltip();
        return;
      }
      closeLayerGroupTooltips(cityLayer, layer);
      layer.openTooltip();
    },
    tooltipopen: () => {
      if (isHoverSuppressed || !activeProvinceGb || activeCityGb || !isFeatureVisibleInActiveProvince(feature, "city")) {
        layer.closeTooltip();
      }
    }
  });
}

const cityLayer = L.geoJSON(null, {
  interactive: true,
  onEachFeature: setupCityInteractions,
  pane: "overlayPane",
  renderer: adminRenderer,
  smoothFactor: 0,
  style: getCityStyle
}).addTo(map);

function setupProvinceInteractions(feature, layer) {
  const provinceName = getFeatureName(feature);
  if (provinceName) {
    layer.bindTooltip(provinceName, {
      className: "admin-tooltip",
      direction: "top",
      sticky: true
    });
  }

  layer.on({
    click: () => {
      enterProvince(layer);
    },
    mouseout: () => {
      layer.closeTooltip();
      layer.setStyle(getProvinceStyle(feature));
    },
    mouseover: () => {
      if (isHoverSuppressed || activeProvinceGb || !isFeatureVisibleInActiveProvince(feature, "province")) {
        layer.closeTooltip();
        return;
      }
      closeLayerGroupTooltips(provinceLayer, layer);
      layer.openTooltip();
    },
    tooltipopen: () => {
      if (isHoverSuppressed || activeProvinceGb || !isFeatureVisibleInActiveProvince(feature, "province")) {
        layer.closeTooltip();
      }
    }
  });
}

const provinceLayer = L.geoJSON(null, {
  interactive: true,
  onEachFeature: setupProvinceInteractions,
  pane: "overlayPane",
  renderer: adminRenderer,
  smoothFactor: 0,
  style: getProvinceStyle
}).addTo(map);

function updateBoundaryWeights() {
  refreshAdministrativeStyles();
}

map.on("zoomend", updateBoundaryWeights);
map.on("mouseout", event => {
  const relatedTarget = event.originalEvent && event.originalEvent.relatedTarget;
  if (!relatedTarget || !map.getContainer().contains(relatedTarget)) {
    closeAdministrativeTooltips();
  }
});

if (SHOW_TDT_REFERENCE_BORDER) {
  tdtBorderLayer.on("tileerror", event => {
    event.tile.src = BLANK_TILE;
  });
  tdtBorderLayer.addTo(map);
}

const progress = document.querySelector("#progress");
const progressBar = document.querySelector("#progress > span");

function setProgress(done, total) {
  const ratio = total ? Math.min(done / total, 1) : 0;
  progressBar.style.transform = `scaleX(${ratio})`;
  if (ratio >= 1) {
    window.setTimeout(() => {
      progress.hidden = true;
    }, 260);
  }
}

function regionMapUrl(gb, level) {
  return `${API_BASE}/region/map?gb=${encodeURIComponent(gb)}&level=${level}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "force-cache", mode: "cors" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function inflateGzip(bytes) {
  if ("DecompressionStream" in window) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      // Fall through to pako when the browser exposes DecompressionStream but rejects this payload.
    }
  }

  if (window.pako && window.pako.inflate) {
    return window.pako.inflate(bytes);
  }

  throw new Error("No gzip inflater is available in this browser.");
}

async function decodeTiandituGeoJson(arrayBuffer) {
  const inflated = await inflateGzip(new Uint8Array(arrayBuffer));
  const decoded = new Uint8Array(Math.floor(inflated.length / 4));

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < inflated.length; sourceIndex += 4, targetIndex += 1) {
    let value = 0;
    for (let offset = 0; offset < 4; offset += 1) {
      value += (inflated[sourceIndex + offset] & 255) * (2 ** (8 * (3 - offset)));
    }
    decoded[targetIndex] = value >> 2;
  }

  return JSON.parse(new TextDecoder("utf-8").decode(decoded));
}

async function fetchRegionMap(gb, level, attempt = 0) {
  try {
    const response = await fetch(regionMapUrl(gb, level), {
      cache: "force-cache",
      mode: "cors"
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return decodeTiandituGeoJson(await response.arrayBuffer());
  } catch (error) {
    if (attempt < 2) {
      await new Promise(resolve => window.setTimeout(resolve, 350 + attempt * 650));
      return fetchRegionMap(gb, level, attempt + 1);
    }
    console.warn("Failed to load administrative region", gb, error);
    return { type: "FeatureCollection", features: [] };
  }
}

function collectCityRequestNodes(root) {
  return (root.children || [])
    .map(province => {
      const cityChildren = (province.children || []).filter(child => (child.children || []).length);
      return {
        gb: province.gb,
        cityGbs: new Set(cityChildren.map(child => child.gb))
      };
    })
    .filter(node => node.gb && node.cityGbs.size);
}

function collectCountyRequestNodes(root) {
  const nodes = [];

  function visit(node, isRoot = false) {
    const children = node.children || [];

    if (!children.length) {
      if (isRoot) nodes.push(node);
      return;
    }

    const leafChildren = children.filter(child => !(child.children || []).length);
    const branchChildren = children.filter(child => (child.children || []).length);

    if (!isRoot && leafChildren.length) nodes.push(node);
    branchChildren.forEach(child => visit(child));
    if (isRoot) leafChildren.forEach(child => nodes.push(child));
  }

  visit(root, true);

  return Array.from(
    new Map(
      nodes
        .filter(node => node && node.gb && node.gb !== CHINA_GB)
        .map(node => [node.gb, node])
    ).values()
  );
}

function collectLeafGbs(node) {
  const children = node.children || [];
  if (!children.length) return node.gb ? [node.gb] : [];

  return children.flatMap(child => collectLeafGbs(child));
}

function indexProvinceChildren(root) {
  provinceCityGbsByGb.clear();
  provinceCountyGbsByGb.clear();
  provinceDirectCountyGbsByGb.clear();
  cityParentProvinceGbByGb.clear();
  cityCountyGbsByGb.clear();
  countyParentCityGbByGb.clear();
  countyParentProvinceGbByGb.clear();

  (root.children || []).forEach(province => {
    if (!province.gb) return;

    const cityGbs = new Set(
      (province.children || [])
        .filter(child => (child.children || []).length)
        .map(child => child.gb)
        .filter(Boolean)
    );

    provinceCityGbsByGb.set(province.gb, cityGbs);
    const provinceCountyGbs = new Set(collectLeafGbs(province));
    provinceCountyGbsByGb.set(province.gb, provinceCountyGbs);
    provinceCountyGbs.forEach(countyGb => {
      countyParentProvinceGbByGb.set(countyGb, province.gb);
    });

    const directCountyGbs = new Set(
      (province.children || [])
        .filter(child => child.gb && !(child.children || []).length)
        .map(child => child.gb)
    );
    provinceDirectCountyGbsByGb.set(
      province.gb,
      directCountyGbs
    );
    directCountyGbs.forEach(countyGb => {
      countyParentCityGbByGb.set(countyGb, province.gb);
    });

    (province.children || [])
      .filter(child => child.gb && (child.children || []).length)
      .forEach(city => {
        cityParentProvinceGbByGb.set(city.gb, province.gb);
        const cityCountyGbs = new Set(collectLeafGbs(city));
        cityCountyGbsByGb.set(city.gb, cityCountyGbs);
        cityCountyGbs.forEach(countyGb => {
          countyParentCityGbByGb.set(countyGb, city.gb);
        });
      });
  });
}

function filterFeaturesByGb(region, allowedGbs) {
  return {
    ...region,
    features: (region.features || []).filter(feature => allowedGbs.has(feature.properties && feature.properties.gb))
  };
}

async function runWithLimit(items, limit, worker) {
  let current = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (current < items.length) {
      const index = current;
      current += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function loadMap() {
  const menu = await fetchJson(MENU_URL);
  const root = menu.data && menu.data[0];
  if (!root) throw new Error("Administrative menu is empty.");

  indexProvinceChildren(root);
  const cityParents = collectCityRequestNodes(root);
  const countyParents = collectCountyRequestNodes(root);
  const total = cityParents.length + countyParents.length + 1;
  let done = 0;

  const provinces = await fetchRegionMap(CHINA_GB, 2);
  provinceLayer.addData(provinces);
  setProgress(++done, total);

  await runWithLimit(cityParents, 10, async node => {
    const region = filterFeaturesByGb(await fetchRegionMap(node.gb, 1), node.cityGbs);
    if (region.features && region.features.length) {
      cityLayer.addData(region);
    }
    setProgress(++done, total);
  });

  await runWithLimit(countyParents, 10, async node => {
    const region = await fetchRegionMap(node.gb, 0);
    if (region.features && region.features.length) {
      countyLayer.addData(region);
      coverageLayer.addData(region);
    }
    setProgress(++done, total);
  });

  countyLayer.bringToFront();
  cityLayer.bringToFront();
  provinceLayer.bringToFront();
  coverageLayer.bringToFront();
  resetBounds = countyLayer.getBounds().extend(cityLayer.getBounds()).extend(provinceLayer.getBounds());
  baseStrokeZoom = map.getZoom();
  if (!restoreSavedProgress()) {
    updateBoundaryWeights();
  }
  setProgress(total, total);
}

loadMap().catch(error => {
  console.error(error);
  progress.hidden = true;
});
