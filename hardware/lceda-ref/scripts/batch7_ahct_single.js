async function findDev(key, match) {
  const r = await eda.lib_Device.search(key);
  if (!r || !r.length) throw new Error("no result: " + key);
  if (match) return r.find(d => d.name === match) || r.find(d => d.name.includes(match)) || r[0];
  return r[0];
}
const out = { deleted: 0, wiresDeleted: 0, placed: [] };

const ids = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
const toDelete = [];
for (const id of ids) {
  try {
    const p = await eda.sch_PrimitiveComponent.get([id]);
    const prim = Array.isArray(p) ? p[0] : p;
    if (!prim) continue;
    const ref = prim.getState_Designator();
    if (ref === "U3" || ref === "U4") toDelete.push(id);
  } catch (e) {}
}
if (toDelete.length) { await eda.sch_PrimitiveComponent.delete(toDelete); out.deleted = toDelete.length; }

try {
  const wids = (await eda.sch_PrimitiveWire.getAllPrimitiveId()) || [];
  const wDel = [];
  for (const wid of wids) {
    try {
      const w = await eda.sch_PrimitiveWire.get([wid]);
      const prim = Array.isArray(w) ? w[0] : w;
      if (!prim) continue;
      const x = prim.getState_X(), y = prim.getState_Y();
      if (x > 880 && x < 1030 && y > 1480 && y < 1980) wDel.push(wid);
      else if (x > 1130 && x < 1280 && y > 1480 && y < 1980) wDel.push(wid);
    } catch (e) {}
  }
  if (wDel.length) { await eda.sch_PrimitiveWire.delete(wDel); out.wiresDeleted = wDel.length; }
} catch (e) { out.wireScan = String(e).slice(0, 60); }

const dev = await findDev("74AHCT125D-Q100118");
const chips = [["U3", 950, 1], ["U4", 1200, 5]];
for (const [ref, bx, fanBase] of chips) {
  const comp = await eda.sch_PrimitiveComponent.create(dev, bx, 1750, undefined, 0, false, true, true);
  if (!comp) { out.placed.push({ ref, err: "create failed" }); continue; }
  const pid = comp.getState_PrimitiveId();
  await eda.sch_PrimitiveComponent.modify(pid, { designator: ref, name: "74AHCT125" });
  const pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(pid)) || [];
  const labeled = [];
  for (const p of pins) {
    const num = String(p.pinNumber);
    const gate = Math.floor((Number(num) - 1) / 3) + 1;
    let net = null;
    const inGate = Number(num) >= 1 && Number(num) <= 6 ? (Number(num) - 1) % 3 : null;
    if (num === "7") net = "GND";
    else if (num === "14") net = "+5V";
    else if (num === "13" || num === "10" || num === "4" || num === "1") net = "GND";
    else {
      const fan = fanBase + (num <= 6 ? Math.ceil(num / 3) - 1 : (num >= 11 ? 3 : 2));
      if (num === "2" || num === "5" || num === "12" || num === "9") net = "FAN" + fan + "_PWM";
      else if (num === "3" || num === "6" || num === "11" || num === "8") net = "FAN" + fan + "_PWM_OUT";
    }
    if (!net) { labeled.push("SKIP" + num); continue; }
    const dx = p.rotation === 0 ? 10 : (p.rotation === 180 ? -10 : 0);
    const dy = p.rotation === 90 ? 10 : (p.rotation === 270 ? -10 : 0);
    try {
      await eda.sch_PrimitiveWire.create([p.x, p.y, p.x + dx, p.y + dy], net);
      labeled.push(num + "=" + net);
    } catch (e) { labeled.push(num + ":ERR"); }
  }
  out.placed.push({ ref, pid, pins: pins.length, labeled });
}
return out;
