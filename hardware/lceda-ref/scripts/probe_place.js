async function findDev(key, match) {
  const r = await eda.lib_Device.search(key);
  if (!r || !r.length) throw new Error("no result: " + key);
  if (match) {
    const hit = r.find(d => d.name === match) || r.find(d => d.name.includes(match));
    if (hit) return hit;
  }
  return r[0];
}

const DEFS = [
  ["U1", "AMS1117-3.3", null, 700, 2420],
  ["U2", "ESP32-S3-WROOM-1-N16R8", null, 700, 1750],
  ["U3", "74AHCT125D", null, 950, 1800],
  ["U5", "BME280", null, 1250, 1800],
  ["U6", "USBLC6-2SC6", "USBLC6-2SC6_C7519", 1550, 750],
  ["LED1", "WS2812B-2020", null, 900, 450],
  ["J1", "sata7+15", "sata7+15", 200, 2400],
  ["J2", "TYPE-C-31-M-12", "TYPE-C-31-M-12", 1350, 750],
  ["J3", "640454-4", "640454-4", 150, 700],
  ["J11", "B3B-XH-A", "B3B-XH-A-3PZZ", 600, 450],
  ["R1", "0805W8F1002T5E_C17414", null, 950, 1400],
  ["R53", "0805W8F330JT5E", null, 830, 450],
  ["C5", "CC0805KRX7R9BB104", null, 980, 2350],
  ["C1", "CL21A106KAYNNNE_C15850", null, 820, 2350],
  ["C470", "电解电容 470UF 16V", null, 1050, 2400],
  ["C100", "电解电容 100UF 16V", null, 1150, 2400],
  ["SW1", "PTS645", "PTS645VM13SMTR92LFS", 1050, 1400],
  ["F1", "SMD1812P300", "SMD1812P300TFT", 400, 2500],
  ["F2", "1A/24V-1812", null, 400, 2350],
  ["D1", "SS34", "SS34_C8678", 500, 2500],
  ["D2", "B5819W", "B5819W", 500, 2350],
];

const out = {};
const created = [];
for (const [ref, key, match, x, y] of DEFS) {
  try {
    const dev = await findDev(key, match);
    const comp = await eda.sch_PrimitiveComponent.create(dev, x, y, undefined, 0, false, true, true);
    if (!comp) { out[ref] = "CREATE FAILED"; continue; }
    const pid = comp.getState_PrimitiveId();
    created.push(pid);
    await eda.sch_PrimitiveComponent.modify(pid, { designator: ref, name: dev.name.replace(/_[Cc]\d+$/, "") });
    const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(pid) || [];
    out[ref] = {
      dev: dev.name, pid,
      pins: pins.map(p => ({ n: p.pinNumber, nm: p.pinName, x: p.x, y: p.y, rot: p.rotation }))
    };
  } catch (e) {
    out[ref] = "ERR " + e.message;
  }
}
return out;
