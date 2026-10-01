async function findDev(key, match) {
  const r = await eda.lib_Device.search(key);
  if (!r || !r.length) throw new Error("no result: " + key);
  if (match) return r.find(d => d.name === match) || r.find(d => d.name.includes(match)) || r[0];
  return r[0];
}
const out = [];
const FH = await findDev("640454-4");
const R10 = await findDev("0805W8F1002T5E_C17414");
const C1n = await findDev("CL21B102KBCNNNC");
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
for (let n = 4; n <= 10; n++) {
  const fan = n - 2;
  await placeLabeled("J" + n, FH, 150 + (n - 3) * 65, 700, 0,
    { 1: "GND", 2: "+12V", 3: "FAN" + fan + "_TACH_IN", 4: "FAN" + fan + "_PWM_OUT" });
}
for (let n = 1; n <= 8; n++) {
  const x0 = 200 + ((n - 1) % 4) * 140;
  const y = n <= 4 ? 950 : 1050;
  const rn = 12 + (n - 1) * 4;
  await placeLabeled("R" + rn, R10, x0, y, 90, { 1: "+5V", 2: "FAN" + n + "_TACH_IN" });
  await placeLabeled("R" + (rn + 1), R10, x0 + 30, y, 90, { 1: "FAN" + n + "_TACH_IN", 2: "FAN" + n + "_TACH" });
  await placeLabeled("R" + (rn + 2), R10, x0 + 60, y, 90, { 1: "FAN" + n + "_TACH", 2: "GND" });
  await placeLabeled("C" + (12 + n), C1n, x0 + 90, y, 90, { 1: "FAN" + n + "_TACH", 2: "GND" });
}
return out;
