const NETS = {"U1": {"_by": "name", "VIN": "+5V", "VOUT": "+3V3", "GND": "GND"}, "U2": {"_by": "name", "EN": "RESET", "IO0": "BOOT", "IO1": "ADC_12V", "IO2": "ADC_5V", "IO4": "ADC_3V3", "IO5": "FAN1_PWM", "IO6": "FAN2_PWM", "IO7": "FAN3_PWM", "IO8": "FAN4_PWM", "IO9": "FAN5_PWM", "IO10": "FAN6_PWM", "IO11": "FAN7_PWM", "IO12": "FAN8_PWM", "IO13": "FAN1_TACH", "IO14": "FAN2_TACH", "IO15": "FAN3_TACH", "IO16": "DS18B20_DQ", "IO17": "I2C_SDA", "IO18": "I2C_SCL", "IO21": "FAN4_TACH", "IO38": "FAN5_TACH", "IO39": "FAN6_TACH", "IO40": "FAN7_TACH", "IO41": "FAN8_TACH", "IO42": "SPI_SCK", "RXD0": "SPI_CS", "TXD0": "SPI_MOSI", "IO45": "WS2812B_DI", "IO47": "BTN_WIFI_CFG", "IO48": "SPI_DC", "USB_D-": "USB_DN", "USB_D+": "USB_DP", "3V3": "+3V3", "GND": "GND", "IO19": "USB_DN", "IO20": "USB_DP"}, "U5": {"_by": "name", "GND": "GND", "CSB": "+3V3", "SDI": "I2C_SDA", "SCK": "I2C_SCL", "SDO": "GND", "VDDIO": "+3V3", "VDD": "+3V3"}, "U6": {"_by": "name", "I/O1": "USB_DN", "I/O2": "USB_DP", "GND": "GND", "VBUS": "+5V"}, "LED1": {"_by": "name", "VSS": "GND", "DI": "WS2812_DIN", "VDD": "+3V3"}, "J1": {"_by": "num", "11": "GND", "12": "GND", "13": "GND", "14": "+5V", "15": "+5V", "16": "+5V", "17": "GND", "18": "GND", "19": "GND", "20": "+12V", "21": "+12V", "22": "+12V", "0": "GND"}, "J2": {"_by": "name", "GND": "GND", "VBUS": "VBUS", "DP1": "USB_DP", "DP2": "USB_DP", "DN1": "USB_DN", "DN2": "USB_DN", "CC1": "CC1", "CC2": "CC2", "EH": "GND"}, "J11": {"_by": "num", "1": "GND", "2": "DS18B20_DQ", "3": "+3V3"}, "J12": {"_by": "num", "1": "GND", "2": "DS18B20_DQ", "3": "+3V3"}, "J13": {"_by": "num", "1": "+3V3", "2": "GND", "3": "SPI_SCK", "4": "SPI_MOSI", "5": "SPI_CS", "6": "SPI_DC", "7": "I2C_SDA", "8": "I2C_SCL"}, "R1": {"_by": "num", "1": "+3V3", "2": "RESET"}, "R2": {"_by": "num", "1": "+3V3", "2": "BOOT"}, "C6": {"_by": "num", "1": "RESET", "2": "GND"}, "R53": {"_by": "num", "1": "WS2812B_DI", "2": "WS2812_DIN"}, "R54": {"_by": "num", "1": "+3V3", "2": "BTN_WIFI_CFG"}, "R55": {"_by": "num", "1": "CC1", "2": "GND"}, "R56": {"_by": "num", "1": "CC2", "2": "GND"}, "C22": {"_by": "num", "1": "VBUS", "2": "GND"}, "C23": {"_by": "num", "1": "VBUS", "2": "GND"}, "C1": {"_by": "num", "1": "+12V", "2": "GND"}, "C2": {"_by": "num", "1": "+5V", "2": "GND"}, "C3": {"_by": "num", "1": "+12V", "2": "GND"}, "C4": {"_by": "num", "1": "+5V", "2": "GND"}, "C5": {"_by": "num", "1": "+3V3", "2": "GND"}, "F1": {"_by": "num", "1": "+12V_IN", "2": "+12V_SW"}, "F2": {"_by": "num", "1": "+5V_IN", "2": "+5V_SW"}, "D1": {"_by": "num", "1": "+12V", "2": "+12V_SW"}, "D2": {"_by": "num", "1": "+5V", "2": "+5V_SW"}, "D3": {"_by": "num", "1": "+5V", "2": "VBUS"}, "SW1": {"_by": "num", "1": "RESET", "3": "RESET", "5": "RESET", "2": "GND", "4": "GND", "6": "GND", "7": "GND"}, "SW2": {"_by": "num", "1": "BOOT", "3": "BOOT", "5": "BOOT", "2": "GND", "4": "GND", "6": "GND", "7": "GND"}, "SW3": {"_by": "num", "1": "BTN_WIFI_CFG", "3": "BTN_WIFI_CFG", "5": "BTN_WIFI_CFG", "2": "GND", "4": "GND", "6": "GND", "7": "GND"}, "J3": {"_by": "num", "1": "GND", "2": "+12V", "3": "FAN1_TACH_IN", "4": "FAN1_PWM_OUT"}, "R12": {"_by": "num", "1": "+5V", "2": "FAN1_TACH_IN"}, "R13": {"_by": "num", "1": "FAN1_TACH_IN", "2": "FAN1_TACH"}, "R14": {"_by": "num", "1": "FAN1_TACH", "2": "GND"}, "C13": {"_by": "num", "1": "FAN1_TACH", "2": "GND"}, "R4": {"_by": "num", "1": "FAN1_PWM", "2": "GND"}, "J4": {"_by": "num", "1": "GND", "2": "+12V", "3": "FAN2_TACH_IN", "4": "FAN2_PWM_OUT"}, "R16": {"_by": "num", "1": "+5V", "2": "FAN2_TACH_IN"}, "R17": {"_by": "num", "1": "FAN2_TACH_IN", "2": "FAN2_TACH"}, "R18": {"_by": "num", "1": "FAN2_TACH", "2": "GND"}, "C14": {"_by": "num", "1": "FAN2_TACH", "2": "GND"}, "R5": {"_by": "num", "1": "FAN2_PWM", "2": "GND"}, "J5": {"_by": "num", "1": "GND", "2": "+12V", "3": "FAN3_TACH_IN", "4": "FAN3_PWM_OUT"}, "R20": {"_by": "num", "1": "+5V", "2": "FAN3_TACH_IN"}, "R21": {"_by": "num", "1": "FAN3_TACH_IN", "2": "FAN3_TACH"}, "R22": {"_by": "num", "1": "FAN3_TACH", "2": "GND"}, "C15": {"_by": "num", "1": "FAN3_TACH", "2": "GND"}, "R6": {"_by": "num", "1": "FAN3_PWM", "2": "GND"}, "J6": {"_by": "num", "1": "GND", "2": "+12V", "3": "FAN4_TACH_IN", "4": "FAN4_PWM_OUT"}, "R24": {"_by": "num", "1": "+5V", "2": "FAN4_TACH_IN"}, "R25": {"_by": "num", "1": "FAN4_TACH_IN", "2": "FAN4_TACH"}, "R26": {"_by": "num", "1": "FAN4_TACH", "2": "GND"}, "C16": {"_by": "num", "1": "FAN4_TACH", "2": "GND"}, "R7": {"_by": "num", "1": "FAN4_PWM", "2": "GND"}, "J7": {"_by": "num", "1": "GND", "2": "+12V", "3": "FAN5_TACH_IN", "4": "FAN5_PWM_OUT"}, "R28": {"_by": "num", "1": "+5V", "2": "FAN5_TACH_IN"}, "R29": {"_by": "num", "1": "FAN5_TACH_IN", "2": "FAN5_TACH"}, "R30": {"_by": "num", "1": "FAN5_TACH", "2": "GND"}, "C17": {"_by": "num", "1": "FAN5_TACH", "2": "GND"}, "R8": {"_by": "num", "1": "FAN5_PWM", "2": "GND"}, "J8": {"_by": "num", "1": "GND", "2": "+12V", "3": "FAN6_TACH_IN", "4": "FAN6_PWM_OUT"}, "R32": {"_by": "num", "1": "+5V", "2": "FAN6_TACH_IN"}, "R33": {"_by": "num", "1": "FAN6_TACH_IN", "2": "FAN6_TACH"}, "R34": {"_by": "num", "1": "FAN6_TACH", "2": "GND"}, "C18": {"_by": "num", "1": "FAN6_TACH", "2": "GND"}, "R9": {"_by": "num", "1": "FAN6_PWM", "2": "GND"}, "J9": {"_by": "num", "1": "GND", "2": "+12V", "3": "FAN7_TACH_IN", "4": "FAN7_PWM_OUT"}, "R36": {"_by": "num", "1": "+5V", "2": "FAN7_TACH_IN"}, "R37": {"_by": "num", "1": "FAN7_TACH_IN", "2": "FAN7_TACH"}, "R38": {"_by": "num", "1": "FAN7_TACH", "2": "GND"}, "C19": {"_by": "num", "1": "FAN7_TACH", "2": "GND"}, "R10": {"_by": "num", "1": "FAN7_PWM", "2": "GND"}, "J10": {"_by": "num", "1": "GND", "2": "+12V", "3": "FAN8_TACH_IN", "4": "FAN8_PWM_OUT"}, "R40": {"_by": "num", "1": "+5V", "2": "FAN8_TACH_IN"}, "R41": {"_by": "num", "1": "FAN8_TACH_IN", "2": "FAN8_TACH"}, "R42": {"_by": "num", "1": "FAN8_TACH", "2": "GND"}, "C20": {"_by": "num", "1": "FAN8_TACH", "2": "GND"}, "R11": {"_by": "num", "1": "FAN8_PWM", "2": "GND"}, "R44": {"_by": "num", "1": "+12V", "2": "ADC_12V"}, "R45": {"_by": "num", "1": "ADC_12V", "2": "GND"}, "R46": {"_by": "num", "1": "+5V", "2": "ADC_5V"}, "R47": {"_by": "num", "1": "ADC_5V", "2": "GND"}, "R48": {"_by": "num", "1": "+3V3", "2": "ADC_3V3"}, "R49": {"_by": "num", "1": "ADC_3V3", "2": "GND"}, "R50": {"_by": "num", "1": "+3V3", "2": "I2C_SDA"}, "R51": {"_by": "num", "1": "+3V3", "2": "I2C_SCL"}, "R52": {"_by": "num", "1": "+3V3", "2": "DS18B20_DQ"}};
const GATES = {"U3": [{"pins": ["2", "3", "1"], "m": {"2": "FAN1_PWM", "3": "FAN1_PWM_OUT", "1": "GND"}}, {"pins": ["2", "3", "1"], "m": {"2": "FAN2_PWM", "3": "FAN2_PWM_OUT", "1": "GND"}}, {"pins": ["9", "8", "10"], "m": {"9": "FAN3_PWM", "8": "FAN3_PWM_OUT", "10": "GND"}}, {"pins": ["12", "11", "13"], "m": {"12": "FAN4_PWM", "11": "FAN4_PWM_OUT", "13": "GND"}}, {"pins": ["7", "14"], "m": {"7": "GND", "14": "+5V"}}], "U4": [{"pins": ["2", "3", "1"], "m": {"2": "FAN5_PWM", "3": "FAN5_PWM_OUT", "1": "GND"}}, {"pins": ["4", "5", "6"], "m": {"5": "FAN6_PWM", "6": "FAN6_PWM_OUT", "4": "GND"}}, {"pins": ["9", "8", "10"], "m": {"9": "FAN7_PWM", "8": "FAN7_PWM_OUT", "10": "GND"}}, {"pins": ["12", "11", "13"], "m": {"12": "FAN8_PWM", "11": "FAN8_PWM_OUT", "13": "GND"}}, {"pins": ["7", "14"], "m": {"7": "GND", "14": "+5V"}}]};
const START = Number("0");
const COUNT = Number("35");
const ids = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
const slice = ids.slice(START, START + COUNT);
const out = [];
for (const id of slice) {
  let ref = null, pins = null, gerr = null;
  try {
    const p = await eda.sch_PrimitiveComponent.get([id]);
    const prim = Array.isArray(p) ? p[0] : p;
    if (!prim) continue;
    ref = prim.getState_Designator();
    if (!ref || String(ref) === "None" || String(ref).startsWith("#")) continue;
    pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(id)) || [];
  } catch (e) { out.push({ id: id.slice(0,8), err: String(e).slice(0,60) }); continue; }
  const rec = { ref, wired: 0, nc: 0, errs: [] };
  let netmap = NETS[ref];
  let gateMap = null;
  if (GATES[ref]) {
    const nums = pins.map(p => String(p.pinNumber)).sort().join(",");
    for (const g of GATES[ref]) {
      const gs = g.pins.slice().sort().join(",");
      if (nums === gs) { gateMap = g.m; break; }
    }
    if (!gateMap) { rec.errs.push("gate-unmatched:" + nums); out.push(rec); continue; }
  }
  for (const p of pins) {
    const num = String(p.pinNumber), nm = p.pinName || "";
    let net = null;
    if (gateMap) net = gateMap[num] !== undefined ? gateMap[num] : null;
    else if (netmap) {
      if (netmap._by === "name" && netmap[nm] !== undefined) net = netmap[nm];
      else if (netmap._by === "num" && netmap[num] !== undefined) net = netmap[num];
    }
    if (!net) {
      if (netmap && netmap._by === "name") {
        try {
          const pid2 = p.primitiveId;
          if (pid2) { await eda.sch_PrimitivePin.modify(pid2, { noConnected: true }); rec.nc++; }
        } catch (e) { rec.errs.push("nc:" + num); }
      }
      continue;
    }
    const dx = p.rotation === 0 ? 10 : (p.rotation === 180 ? -10 : 0);
    const dy = p.rotation === 90 ? 10 : (p.rotation === 270 ? -10 : 0);
    try {
      await eda.sch_PrimitiveWire.create([p.x, p.y, p.x + dx, p.y + dy], net);
      rec.wired++;
    } catch (e) { rec.errs.push(num + ":" + String(e).slice(0, 40)); }
  }
  if (rec.wired || rec.nc || rec.errs.length) out.push(rec);
}
return { processed: slice.length, results: out };
