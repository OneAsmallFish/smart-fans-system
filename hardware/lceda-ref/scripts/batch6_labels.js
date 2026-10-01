const ESP_NETS = {
  EN: "RESET", IO0: "BOOT", IO1: "ADC_12V", IO2: "ADC_5V", IO4: "ADC_3V3",
  IO5: "FAN1_PWM", IO6: "FAN2_PWM", IO7: "FAN3_PWM", IO8: "FAN4_PWM",
  IO9: "FAN5_PWM", IO10: "FAN6_PWM", IO11: "FAN7_PWM", IO12: "FAN8_PWM",
  IO13: "FAN1_TACH", IO14: "FAN2_TACH", IO15: "FAN3_TACH", IO16: "DS18B20_DQ",
  IO17: "I2C_SDA", IO18: "I2C_SCL", IO21: "FAN4_TACH", IO38: "FAN5_TACH",
  IO39: "FAN6_TACH", IO40: "FAN7_TACH", IO41: "FAN8_TACH", IO42: "SPI_SCK",
  RXD0: "SPI_CS", TXD0: "SPI_MOSI", IO45: "WS2812B_DI", IO47: "BTN_WIFI_CFG",
  IO48: "SPI_DC", "USB_D-": "USB_DN", "USB_D+": "USB_DP", "3V3": "+3V3", GND: "GND"
};
const TARGETS = [
  { pid: "644227885b50caa7", byName: { VIN: "+5V", VOUT: "+3V3", GND: "GND" } },
  { pid: "79fb8240d44315d4", byName: ESP_NETS },
  { pid: "7ecff6a010128f16", byName: { GND: "GND", CSB: "+3V3", SDI: "I2C_SDA", SCK: "I2C_SCL", SDO: "GND", VDDIO: "+3V3", VDD: "+3V3" } },
  { pid: "3c21841115678e24", byName: { "I/O1": "USB_DN", "I/O2": "USB_DP", GND: "GND", VBUS: "+5V" } },
  { pid: "0a82039d29d868c2", byName: { VSS: "GND", DIN: "WS2812_DIN", VDD: "+3V3" } },
  { pid: "74400d8ab8a94451", byNumber: { 11: "GND", 12: "GND", 13: "GND", 14: "+5V", 15: "+5V", 16: "+5V", 17: "GND", 18: "GND", 19: "GND", 20: "+12V", 21: "+12V", 22: "+12V", 0: "GND" } },
  { pid: "51d33d71c1861111", byName: { GND: "GND", VBUS: "VBUS", DP1: "USB_DP", DP2: "USB_DP", DN1: "USB_DN", DN2: "USB_DN", CC1: "CC1", CC2: "CC2", EH: "GND" } },
  { pid: "a75662a942ffce88", byNumber: { 1: "GND", 2: "+12V", 3: "FAN1_TACH_IN", 4: "FAN1_PWM_OUT" } },
  { pid: "bfedacf0b1447b68", byNumber: { 1: "GND", 2: "DS18B20_DQ", 3: "+3V3" } },
  { pid: "a2856a662b719df9", byNumber: { 1: "+3V3", 2: "RESET" } },
  { pid: "4073dcf21c348123", byNumber: { 1: "WS2812B_DI", 2: "WS2812_DIN" } },
  { pid: "1a4a324bbd0d42b6", byNumber: { 1: "+3V3", 2: "GND" } },
  { pid: "34ea2a6e4756e043", byNumber: { 1: "+5V", 2: "GND" } },
  { pid: "a37722ac1ffa3abb", byNumber: { 1: "+5V", 2: "GND" } },
  { pid: "9546b610b68cbd12", byNumber: { 1: "RESET", 3: "RESET", 5: "RESET", 2: "GND", 4: "GND", 6: "GND", 7: "GND" } },
  { pid: "87da0a8e70970b91", byName: { K: "+12V", A: "+12V_SW" } },
  { pid: "083c89d961100f94", byName: { K: "+5V", A: "+5V_SW" } },
  { pid: "7d54b02bada90558", byName: { K: "+12V", A: "+12V_SW" } },
  { pid: "ff8ea245af402fa8", byName: { K: "+5V", A: "+5V_SW" } }
];
const out = [];
for (const t of TARGETS) {
  const rec = { pid: t.pid.slice(0, 8), labeled: [], skipped: [] };
  try {
    const pins = (await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(t.pid)) || [];
    for (const p of pins) {
      let net = t.byName && t.byName[p.pinName] !== undefined ? t.byName[p.pinName]
        : t.byNumber && t.byNumber[String(p.pinNumber)] !== undefined ? t.byNumber[String(p.pinNumber)] : null;
      if (!net) { rec.skipped.push(p.pinNumber + "/" + p.pinName); continue; }
      try {
        if (net === "GND") await eda.sch_PrimitiveComponent.createNetFlag("Ground", "GND", p.x, p.y, 0, false);
        else if (net === "+3V3" || net === "+5V" || net === "+12V") await eda.sch_PrimitiveComponent.createNetFlag("Power", net, p.x, p.y, 0, false);
        else await eda.sch_PrimitiveAttribute.createNetLabel(p.x, p.y, net);
        rec.labeled.push(net);
      } catch (e) { rec.err = String(e).slice(0, 80); }
    }
  } catch (e) { rec.err = String(e).slice(0, 100); }
  out.push(rec);
}
return out;
