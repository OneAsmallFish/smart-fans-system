async function findDev(key, match) {
  const r = await eda.lib_Device.search(key);
  if (!r || !r.length) throw new Error("no result: " + key);
  if (match) return r.find(d => d.name === match) || r.find(d => d.name.includes(match)) || r[0];
  return r[0];
}
const out = {};
const oldC100 = "1bf819275ff60a83";
try { await eda.sch_PrimitiveComponent.delete([oldC100]); out.delC100 = true; } catch (e) { out.delC100 = "skip"; }
const jobs = [
  ["D3", "B5819W", "B5819W", 600, 2350, { 1: "+5V", 2: "VBUS" }],
  ["C1", "LF221M1HBKJ1013VGN", null, 790, 2500, { 1: "+12V", 2: "GND" }],
  ["C3", "CL21A106KAYNNNE_C15850", null, 860, 2500, { 1: "+12V", 2: "GND" }],
];
for (const [ref, key, match, x, y, netmap] of jobs) {
  try {
    const dev = await findDev(key, match);
    const comp = await eda.sch_PrimitiveComponent.create(dev, x, y, undefined, 0, false, true, true);
    if (!comp) { out[ref] = "CREATE FAILED"; continue; }
    const pid = comp.getState_PrimitiveId();
    await eda.sch_PrimitiveComponent.modify(pid, { designator: ref, name: dev.name.replace(/_[Cc]\d+$/, "") });
    const pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(pid)) || [];
    let labeled = 0;
    for (const p of pins) {
      const net = netmap[p.pinNumber] !== undefined ? netmap[p.pinNumber] : netmap[p.pinName];
      if (!net) continue;
      if (net === "GND") await eda.sch_PrimitiveComponent.createNetFlag("Ground", "GND", p.x, p.y, 0, false);
      else await eda.sch_PrimitiveComponent.createNetFlag("Power", net, p.x, p.y, 0, false);
      labeled++;
    }
    out[ref] = { dev: dev.name, pid, pins: pins.length, labeled };
  } catch (e) {
    out[ref] = "ERR " + (e.message || e);
  }
}
out.renames = {};
for (const [pid, ref] of [["34ea2a6e4756e043", "C4"], ["a37722ac1ffa3abb", "C2"]]) {
  try {
    await eda.sch_PrimitiveComponent.modify(pid, { designator: ref });
    out.renames[ref] = true;
  } catch (e) {
    out.renames[ref] = "ERR " + (e.message || e);
  }
}
return out;
