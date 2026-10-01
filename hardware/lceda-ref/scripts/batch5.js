async function findDev(key, match) {
  const r = await eda.lib_Device.search(key);
  if (!r || !r.length) throw new Error("no result: " + key);
  if (match) return r.find(d => d.name === match) || r.find(d => d.name.includes(match)) || r[0];
  return r[0];
}
const out = [];
const R10 = await findDev("0805W8F1002T5E_C17414");
const R47 = await findDev("0805W8F4701T5E");
const R51 = await findDev("0805W8F5101T5E");
const R100k = await findDev("0805W8F1003T5E");
const R20k = await findDev("0805W8F2002T5E");
const R47k = await findDev("0805W8F4702T5E");
const C100n = await findDev("CC0805KRX7R9BB104");
const C10u = await findDev("CL21A106KAYNNNE_C15850");
const SWdev = (await eda.lib_Device.search("PTS645")).find(d => d.name === "PTS645VM13SMTR92LFS");
const XH = await findDev("B3B-XH-A", "B3B-XH-A-3PZZ");
const J13dev = await findDev("1x8 2.54", "排母HDR1X8-2.54");
async function placeLabeled(ref, dev, x, y, rot, netmap) {
  const rec = { ref };
  try {
    const comp = await eda.sch_PrimitiveComponent.create(dev, x, y, undefined, rot, false, true, true);
    if (!comp) { rec.err = "create undefined"; out.push(rec); return; }
    rec.pid = comp.getState_PrimitiveId();
    try { await eda.sch_PrimitiveComponent.modify(rec.pid, { designator: ref, name: (dev.name || "").replace(/_[Cc]\d+$/, "") }); } catch (e) { rec.modErr = String(e).slice(0, 60); }
    const pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(rec.pid)) || [];
    const labeled = [];
    for (const p of pins) {
      let net = netmap[p.pinNumber] !== undefined ? netmap[p.pinNumber] : netmap[p.pinName];
      if (net === undefined && p.pinName && p.pinName.startsWith("DN")) net = "USB_DN";
      if (net === undefined && p.pinName && p.pinName.startsWith("DP")) net = "USB_DP";
      if (!net) continue;
      try {
        if (net === "GND") await eda.sch_PrimitiveComponent.createNetFlag("Ground", "GND", p.x, p.y, 0, false);
        else if (net === "+3V3" || net === "+5V" || net === "+12V") await eda.sch_PrimitiveComponent.createNetFlag("Power", net, p.x, p.y, 0, false);
        else await eda.sch_PrimitiveAttribute.createNetLabel(p.x, p.y, net);
        labeled.push(net);
      } catch (e) { rec.labelErr = String(e).slice(0, 60); }
    }
    rec.labeled = labeled;
  } catch (e) {
    rec.err = String(e).slice(0, 100);
  }
  out.push(rec);
}
await placeLabeled("R44", R100k, 150, 1150, 90, { 1: "+12V", 2: "ADC_12V" });
await placeLabeled("R45", R20k, 150, 1210, 90, { 1: "ADC_12V", 2: "GND" });
await placeLabeled("R46", R47k, 200, 1150, 90, { 1: "+5V", 2: "ADC_5V" });
await placeLabeled("R47", R10, 200, 1210, 90, { 1: "ADC_5V", 2: "GND" });
await placeLabeled("R48", R47k, 250, 1150, 90, { 1: "+3V3", 2: "ADC_3V3" });
await placeLabeled("R49", R10, 250, 1210, 90, { 1: "ADC_3V3", 2: "GND" });
await placeLabeled("R50", R47, 320, 1150, 90, { 1: "+3V3", 2: "I2C_SDA" });
await placeLabeled("R51", R47, 360, 1150, 90, { 1: "+3V3", 2: "I2C_SCL" });
await placeLabeled("R52", R47, 410, 1150, 90, { 1: "+3V3", 2: "DS18B20_DQ" });
await placeLabeled("J12", XH, 460, 1150, 0, { 1: "GND", 2: "DS18B20_DQ", 3: "+3V3" });
await placeLabeled("R54", R10, 980, 450, 90, { 1: "+3V3", 2: "BTN_WIFI_CFG" });
await placeLabeled("SW3", SWdev, 1060, 450, 0, { 1: "BTN_WIFI_CFG", 3: "BTN_WIFI_CFG", 5: "BTN_WIFI_CFG", 2: "GND", 4: "GND", 6: "GND", 7: "GND" });
await placeLabeled("R55", R51, 1290, 600, 90, { 1: "CC1", 2: "GND" });
await placeLabeled("R56", R51, 1330, 600, 90, { 1: "CC2", 2: "GND" });
await placeLabeled("C22", C10u, 1450, 600, 0, { 1: "VBUS", 2: "GND" });
await placeLabeled("C23", C100n, 1520, 600, 0, { 1: "VBUS", 2: "GND" });
await placeLabeled("J13", J13dev, 1450, 420, 0,
  { 1: "+3V3", 2: "GND", 3: "SPI_SCK", 4: "SPI_MOSI", 5: "SPI_CS", 6: "SPI_DC", 7: "I2C_SDA", 8: "I2C_SCL" });
return out;
