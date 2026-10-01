const out = {};

async function findDev(key, match) {
  const r = await eda.lib_Device.search(key);
  if (!r || !r.length) return null;
  if (match) return r.find(d => d.name === match) || r.find(d => d.name.includes(match)) || null;
  return r[0];
}

const u3dev = (await eda.lib_Device.search("74AHCT125D"))[0];
out.u3subparts = {};
for (const sp of ["1", "2", "3", "4", "5", "A", "B", "C", "D", "P"]) {
  try {
    const c = await eda.sch_PrimitiveComponent.create(u3dev, 3000, 3000 + Math.random() * 400, sp, 0, false, true, true);
    if (c) {
      const pid = c.getState_PrimitiveId();
      const pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(pid)) || [];
      out.u3subparts[sp] = { pid, pins: pins.map(p => p.pinNumber + "/" + p.pinName) };
      await eda.sch_PrimitiveComponent.delete([pid]);
    } else {
      out.u3subparts[sp] = null;
    }
  } catch (e) {
    out.u3subparts[sp] = "ERR " + (e.message || e);
  }
}

const sata = (await eda.lib_Device.search("sata7+15")).find(d => d.name === "sata7+15");
out.sataDesc = sata ? sata.description : null;

for (const key of ["Header-Male-2.54_1x8", "1x8 2.54", "排针 1x8", "8P 2.54 排针", "2.54mm 8P"]) {
  const r = await eda.lib_Device.search(key);
  if (r && r.length) { out.j13 = { key, hits: r.slice(0, 3).map(d => d.name) }; break; }
}

for (const key of ["电解电容 100UF 16V 直插", "100UF 16V", "EDK100M", "UVR1E101M"]) {
  const r = await eda.lib_Device.search(key);
  if (r && r.length) { out.c100 = { key, hits: r.slice(0, 3).map(d => ({ name: d.name, fp: d.footprintName })) }; break; }
}
return out;
