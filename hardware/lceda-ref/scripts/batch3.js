async function findDev(key) {
  const r = await eda.lib_Device.search(key);
  return r[0];
}
const out = [];
const R10 = await findDev("0805W8F1002T5E_C17414");
const C100n = await findDev("CC0805KRX7R9BB104");
const SWdev = await findDev("PTS645");
const SWmatch = "PTS645VM13SMTR92LFS";
const swdev = (SWdev && SWdev.name === SWmatch) ? SWdev : (await eda.lib_Device.search("PTS645")).find(d => d.name === SWmatch);
async function placeLabeled(ref, dev, x, y, rot, netmap, sub) {
  const rec = { ref };
  try {
    const comp = await eda.sch_PrimitiveComponent.create(dev, x, y, sub || undefined, rot, false, true, true);
    if (!comp) { rec.err = "create undefined"; out.push(rec); return; }
    rec.pid = comp.getState_PrimitiveId();
    try { await eda.sch_PrimitiveComponent.modify(rec.pid, { designator: ref, name: (dev.name || "").replace(/_[Cc]\d+$/, "") }); } catch (e) { rec.modErr = String(e).slice(0, 60); }
    const pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(rec.pid)) || [];
    const labeled = [];
    for (const p of pins) {
      let net = netmap[p.pinNumber] !== undefined ? netmap[p.pinNumber] : netmap[p.pinName];
      if (net === undefined) net = netmap["*"] || null;
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
for (let n = 1; n <= 8; n++) {
  await placeLabeled("R" + (3 + n), R10, 1350, 1550 + (n - 1) * 40, 0,
    { 1: "FAN" + n + "_PWM", 2: "GND" });
}
await placeLabeled("C6", C100n, 1150, 1400, 0, { 1: "RESET", 2: "GND" });
await placeLabeled("R2", R10, 950, 1300, 0, { 1: "+3V3", 2: "BOOT" });
await placeLabeled("SW2", swdev, 1050, 1300, 0, { 1: "BOOT", 3: "BOOT", 5: "BOOT", 2: "GND", 4: "GND", 6: "GND", 7: "GND" });
for (let i = 0; i < 4; i++) {
  await placeLabeled("C" + (7 + i), C100n, 1250 + i * 60, 1400, 0, { 1: "+3V3", 2: "GND" });
}
return out;
