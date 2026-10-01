async function findDev(key) {
  const r = await eda.lib_Device.search(key);
  return r[0];
}
const out = { u3: [], u4: [] };
try { await eda.sch_PrimitiveComponent.delete(["60f48806c0c3bfab"]); out.delOldU3 = true; } catch (e) { out.delOldU3 = String(e); }
const dev = await findDev("74AHCT125D");
const SP = "SN74AHCT125D.";
const chips = [["U3", 950, 1], ["U4", 1200, 5]];
for (const [ref, bx, fanBase] of chips) {
  for (let part = 1; part <= 5; part++) {
    const y = part === 5 ? 1560 : 1860 - (part - 1) * 60;
    const comp = await eda.sch_PrimitiveComponent.create(dev, bx, y, SP + part, 0, false, true, true);
    if (!comp) { out[ref].push({ part, err: "create failed" }); continue; }
    const pid = comp.getState_PrimitiveId();
    await eda.sch_PrimitiveComponent.modify(pid, { designator: ref, name: "74AHCT125" });
    const pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(pid)) || [];
    const labeled = [];
    for (const p of pins) {
      let net = null;
      if (part === 5) {
        if ((p.pinName || "").toUpperCase().includes("VCC")) net = "+5V";
        else if ((p.pinName || "").toUpperCase().includes("GND")) net = "GND";
      } else {
        const fan = fanBase + part - 1;
        if (p.pinName === "A") net = "FAN" + fan + "_PWM";
        else if (p.pinName === "Y") net = "FAN" + fan + "_PWM_OUT";
        else if (p.pinName === "OE") net = "GND";
      }
      if (!net) continue;
      const rot = net === "GND" ? 0 : 0;
      if (net === "GND") await eda.sch_PrimitiveComponent.createNetFlag("Ground", "GND", p.x, p.y, rot, false);
      else if (net === "+5V") await eda.sch_PrimitiveComponent.createNetFlag("Power", "+5V", p.x, p.y, rot, false);
      else await eda.sch_PrimitiveAttribute.createNetLabel(p.x, p.y, net);
      labeled.push(net);
    }
    out[ref].push({ part, pid, pins: pins.length, labeled });
  }
}
return out;
