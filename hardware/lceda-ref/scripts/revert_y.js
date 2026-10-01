const START = 0;
const COUNT = 400;
const ids = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
let moved = 0, skipped = 0, failed = 0;
for (const id of ids) {
  try {
    const p = await eda.sch_PrimitiveComponent.get([id]);
    const prim = Array.isArray(p) ? p[0] : p;
    if (!prim) { skipped++; continue; }
    const ref = prim.getState_Designator();
    if (!ref || ref === "None" || String(ref).startsWith("#")) { skipped++; continue; }
    const y = prim.getState_Y();
    if (typeof y !== "number") { skipped++; continue; }
    await eda.sch_PrimitiveComponent.modify(id, { y: y + 1000 });
    moved++;
  } catch (e) { failed++; }
}
return { total: ids.length, moved, skipped, failed };
