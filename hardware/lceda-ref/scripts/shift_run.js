const START = 240;
const COUNT = 80;
const ids = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
const slice = ids.slice(START, START + COUNT);
let moved = 0, failed = 0;
for (const id of slice) {
  try {
    const p = await eda.sch_PrimitiveComponent.get([id]);
    const prim = Array.isArray(p) ? p[0] : p;
    if (!prim) continue;
    const x = prim.getState_X(), y = prim.getState_Y();
    if (typeof x !== "number" || typeof y !== "number") continue;
    await eda.sch_PrimitiveComponent.modify(id, { y: y - 1000 });
    moved++;
  } catch (e) { failed++; }
}
return { total: ids.length, processed: slice.length, moved, failed, nextStart: START + COUNT };
