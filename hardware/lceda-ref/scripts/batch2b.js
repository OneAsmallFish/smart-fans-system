async function findDev(key) {
  const r = await eda.lib_Device.search(key);
  return r[0];
}
const out = [];
const dev = await findDev("74AHCT125D");
const SP = "SN74AHCT125D.";
const jobs = [["U3", 950, 1, 4], ["U3", 950, 1, 5], ["U4", 1200, 5, 1], ["U4", 1200, 5, 2], ["U4", 1200, 5, 3], ["U4", 1200, 5, 4], ["U4", 1200, 5, 5]];
for (const [ref, bx, fanBase, part] of jobs) {
  const y = part === 5 ? 1560 : 1860 - (part - 1) * 60;
  const rec = { ref, part };
  try {
    const comp = await eda.sch_PrimitiveComponent.create(dev, bx, y, SP + part, 0, false, true, true);
    if (!comp) { rec.err = "create undefined"; out.push(rec); continue; }
    rec.pid = comp.getState_PrimitiveId();
    try { await eda.sch_PrimitiveComponent.modify(rec.pid, { designator: ref, name: "74AHCT125" }); } catch (e) { rec.modErr = String(e).slice(0, 80); }
    const pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(rec.pid)) || [];
    rec.pins = pins.map(p => p.pinNumber + "/" + p.pinName);
    const labeled = [];
    for (const p of pins) {
      let net = null;
      if (part === 5) {
        const un = (p.pinName || "").toUpperCase();
        if (un.includes("VCC")) net = "+5V";
        else if (un.includes("GND")) net = "GND";
      } else {
        const fan = fanBase + part - 1;
        if (p.pinName === "A") net = "FAN" + fan + "_PWM";
        else if (p.pinName === "Y") net = "FAN" + fan + "_PWM_OUT";
        else if (p.pinName === "OE") net = "GND";
      }
      if (!net) continue;
      try {
        if (net === "GND") await eda.sch_PrimitiveComponent.createNetFlag("Ground", "GND", p.x, p.y, 0, false);
        else if (net === "+5V") await eda.sch_PrimitiveComponent.createNetFlag("Power", "+5V", p.x, p.y, 0, false);
        else await eda.sch_PrimitiveAttribute.createNetLabel(p.x, p.y, net);
        labeled.push(net);
      } catch (e) { rec.labelErr = String(e).slice(0, 80); }
    }
    rec.labeled = labeled;
  } catch (e) {
    rec.err = String(e).slice(0, 120);
  }
  out.push(rec);
}
return out;
