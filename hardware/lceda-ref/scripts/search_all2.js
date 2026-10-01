const keys = ["SATA", "640454-4", "2.54 排针 8P", "自恢复保险丝 1812", "SMD1812P300",
  "0805 10kΩ", "0805 4.7kΩ", "0805 5.1kΩ", "0805 33Ω", "0805 100kΩ", "0805 20kΩ", "0805 47kΩ",
  "0805 100nF", "0805 10uF", "0805 1nF", "470uF 电解", "100uF 电解"];
const out = {};
for (const k of keys) {
  try {
    const r = await eda.lib_Device.search(k);
    out[k] = (r || []).slice(0, 3).map(d => ({ name: d.name, fp: d.footprintName }));
  } catch (e) {
    out[k] = "ERR " + e.message;
  }
}
return out;
