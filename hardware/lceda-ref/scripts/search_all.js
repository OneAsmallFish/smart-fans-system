const keys = ["AMS1117-3.3","ESP32-S3-WROOM-1-N16R8","74AHCT125","BME280","USBLC6-2SC6","WS2812B-2020","TYPE-C-31-M-12","C388659","C86501","B3B-XH-A","C92410","SS34","B5819W","MF-MSMF300","MF-MSMF100","PTS645"];
const out = {};
for (const k of keys) {
  try {
    const r = await eda.lib_Device.search(k);
    out[k] = (r || []).slice(0, 4).map(d => ({
      name: d.name,
      uuid: (d.uuid || "").slice(0, 8),
      lib: (d.libraryUuid || "").slice(0, 8),
      fp: d.footprintName
    }));
  } catch (e) {
    out[k] = "ERR " + e.message;
  }
}
return out;
