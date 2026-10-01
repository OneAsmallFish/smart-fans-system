#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_sch.py — Smart Fan Controller v1.2 KiCad 参考稿生成器
输出: hardware/kicad-reference/smart-fan-controller-v1.2.kicad_sch
依据: hardware/docs/remediation-plan-v1.2.md (v1.2.2) §1~§3
定位: 对比参照稿（决策 D6：嘉立创 EDA 为唯一真源，本稿非权威，禁止用于配单/打样）
"""
import re, uuid, sys, os

SYM_DIR = r"D:/Program Files/KiCad/10.0/share/kicad/symbols"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "smart-fan-controller-v1.2.kicad_sch")
ROOT_UUID = str(uuid.uuid4())
PROJECT = "smart-fan-controller-v1.2-ref"
STRIP_V10_TOKENS = True  # 嵌入符号时剔除 v10 库新增 token，兼容 20231120 原理图格式

# ---------------- S-expression ----------------
def tokenize(s):
    return re.findall(r'\(|\)|"(?:[^"\\]|\\.)*"|[^\s()]+', s)

def parse(tokens):
    stack, cur = [], []
    for t in tokens:
        if t == '(':
            stack.append(cur); cur = []
        elif t == ')':
            done = cur; cur = stack.pop(); cur.append(done)
        else:
            cur.append(('__s__', t[1:-1]) if t.startswith('"') else t)
    return cur[0]

def snap(v):
    return round(round(v / 1.27) * 1.27, 4)

def U():
    return ('__s__', str(uuid.uuid4()))

def sv(n):
    return n[1] if isinstance(n, tuple) else str(n)

def fc(node, head):
    for c in node:
        if isinstance(c, list) and c and c[0] == head:
            return c
    return None

V10_DROP_HEADS = ('show_name', 'do_not_autoplace', 'in_pos_files',
                  'duplicate_pin_numbers_are_jumpers', 'embedded_fonts')

def strip_v10(node):
    """v10 库 token → v20231120 兼容：删除指定子列表；(hide yes)→effects 内裸 hide"""
    if not isinstance(node, list):
        return node
    out = []
    for c in node:
        if isinstance(c, list) and c and isinstance(c[0], str) and c[0] in V10_DROP_HEADS:
            continue
        if isinstance(c, list) and c and c[0] == 'pin_numbers':
            c = ['pin_numbers', 'hide']
        out.append(strip_v10(c))
    # 属性级 (hide yes) → effects 内追加裸 hide（v8 格式）
    if isinstance(node[0], str) and node[0] == 'property':
        hide = next((x for x in out if isinstance(x, list) and x and x[0] == 'hide'), None)
        if hide is not None:
            out = [x for x in out if x is not hide]
            eff = next((x for x in out if isinstance(x, list) and x and x[0] == 'effects'), None)
            if eff is not None:
                if 'hide' not in eff:
                    eff.append('hide')
    return node.__class__(out) if False else out

# ---------------- 库符号 ----------------
_lib_cache = {}
def load_lib(lib):
    if lib not in _lib_cache:
        _lib_cache[lib] = parse(tokenize(open(f"{SYM_DIR}/{lib}.kicad_sym", encoding="utf-8").read()))
    return _lib_cache[lib]

def flatten_symbol(lib, name):
    """返回完整符号节点（展开 extends；单元子符号名改前缀为本符号名）"""
    root = load_lib(lib)
    node = None
    for c in root:
        if isinstance(c, list) and c and c[0] == 'symbol' and isinstance(c[1], tuple) and c[1][1] == name:
            node = c
    if node is None:
        raise KeyError(f"{lib}:{name}")
    ext = fc(node, 'extends')
    if not ext:
        out = ['symbol', ('__s__', name)] + node[2:]
        return out
    parent = flatten_symbol(lib, sv(ext[1]))
    new = ['symbol', ('__s__', name)]
    for c in parent[2:]:
        if isinstance(c, list) and c and c[0] == 'property':
            continue
        if isinstance(c, list) and c and c[0] == 'symbol':
            new.append(['symbol', ('__s__', re.sub(r'^%s_' % re.escape(sv(parent[1])), name + '_', sv(c[1])))]
                       + c[2:])
            continue
        new.append(c)
    for c in node[2:]:
        if isinstance(c, list) and c and c[0] == 'extends':
            continue
        new.append(c)
    return new

def get_pins(units, unit):
    """该单元下取引脚最多的样式（兼容 style0/style1 两种库约定）"""
    styles = units.get(unit, {})
    if not styles:
        return []
    return max(styles.values(), key=len)

def best_unit(units):
    """引脚最多的单元号（默认放置用）"""
    best, n = 0, -1
    for u, styles in units.items():
        tot = sum(len(v) for v in styles.values())
        if tot > n:
            best, n = u, tot
    return best

def units_of(node):
    """{unit: {style: [ {num,name,x,y,a,typ} ]}}"""
    local = sv(node[1]).split(':')[-1]
    units = {}
    for c in node:
        if isinstance(c, list) and c and c[0] == 'symbol' and isinstance(c[1], tuple):
            m = re.match(r'^%s_(\d+)_(\d+)$' % re.escape(local), sv(c[1]))
            if not m:
                continue
            u, st = int(m.group(1)), int(m.group(2))
            pins = []
            for pin in [x for x in c if isinstance(x, list) and x and x[0] == 'pin']:
                at = fc(pin, 'at'); nm = fc(pin, 'name'); nu = fc(pin, 'number')
                pins.append(dict(num=sv(nu[1]) if nu else '?', name=sv(nm[1]) if nm else '',
                                 x=float(at[1]), y=float(at[2]), a=float(at[3]), typ=pin[1]))
            units.setdefault(u, {})[st] = pins
    return units

# ---------------- 文档状态 ----------------
lib_syms, comps, labels, ncs = [], [], [], []
pwr_n = [0]
_embedded = set()

_units_cache = {}
def embed(lib, name):
    key = f"{lib}:{name}"
    if key in _embedded:
        return
    _embedded.add(key)
    flat = flatten_symbol(lib, name)   # 展平 extends（74AHCT125←74LS125）
    flat[1] = ('__s__', key)
    flat = strip_v10(flat)
    lib_syms.append(flat)
    _units_cache[key] = units_of(flat)

def add_pwr(net, x, y):
    """在 (x,y) 放电源符号"""
    x, y = snap(x), snap(y)
    lib, nm = 'power', {'GND': 'GND', '+3V3': '+3V3', '+5V': '+5V', '+12V': '+12V'}[net]
    embed(lib, nm)
    pwr_n[0] += 1
    ref = f"#PWR{pwr_n[0]:02d}"
    comps.append(['symbol', ['lib_id', ('__s__', f'power:{nm}')],
        ['at', f"{x:.4f}", f"{y:.4f}", '0'], ['unit', '1'],
        ['exclude_from_sim', 'no'], ['in_bom', 'yes'], ['on_board', 'yes'], ['dnp', 'no'],
        ['uuid', U()],
        ['property', ('__s__', 'Reference'), ('__s__', ref),
         ['at', f"{x:.4f}", f"{y:.4f}", '0'],
         ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']]],
        ['property', ('__s__', 'Value'), ('__s__', net),
         ['at', f"{x:.4f}", f"{y:.4f}", '0'],
         ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']]],
        ['pin', ('__s__', '1'), ['uuid', U()]],
        ['instances', ['project', ('__s__', PROJECT),
                       ['path', ('__s__', f"/{ROOT_UUID}"), ['reference', ('__s__', ref)], ['unit', '1']]]]])

def add_label(net, x, y, pin_angle):
    if net in ('GND', '+3V3', '+5V', '+12V'):
        add_pwr(net, x, y)
        return
    rot = {0: 180, 180: 0, 90: 270, 270: 90}.get(int(pin_angle), 0)
    labels.append((net, x, y, rot))

def add_flag(net, x, y):
    """PWR_FLAG + 电源符号同点"""
    x, y = snap(x), snap(y)
    embed('power', 'PWR_FLAG')
    pwr_n[0] += 1
    ref = f"#FLG{pwr_n[0]:02d}"
    comps.append(['symbol', ['lib_id', ('__s__', 'power:PWR_FLAG')],
        ['at', f"{x:.4f}", f"{y:.4f}", '0'], ['unit', '1'],
        ['exclude_from_sim', 'no'], ['in_bom', 'yes'], ['on_board', 'yes'], ['dnp', 'no'],
        ['uuid', U()],
        ['property', ('__s__', 'Reference'), ('__s__', ref),
         ['at', f"{x:.4f}", f"{y:.4f}", '0'],
         ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']]],
        ['property', ('__s__', 'Value'), ('__s__', 'PWR_FLAG'),
         ['at', f"{x:.4f}", f"{y:.4f}", '0'],
         ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']]],
        ['pin', ('__s__', '1'), ['uuid', U()]],
        ['instances', ['project', ('__s__', PROJECT),
                       ['path', ('__s__', f"/{ROOT_UUID}"), ['reference', ('__s__', ref)], ['unit', '1']]]]])
    add_pwr(net, x, y)

def add_comp(ref, lib, name, value, x, y, netmap, footprint="", unit=None):
    """netmap: 引脚号→网络名；None→no_connect；'GND' 等→电源符号"""
    x, y = snap(x), snap(y)
    embed(lib, name)
    key = f"{lib}:{name}"
    units = _units_cache[key]
    if unit is None:
        unit = best_unit(units) if units else 0
    pins = get_pins(units, unit)
    uid = str(uuid.uuid4())
    props = [
        ['property', ('__s__', 'Reference'), ('__s__', ref),
         ['at', f"{x:.4f}", f"{y + 5.08:.4f}", '0'],
         ['effects', ['font', ['size', '1.27', '1.27']]]],
        ['property', ('__s__', 'Value'), ('__s__', value),
         ['at', f"{x:.4f}", f"{y - 5.08:.4f}", '0'],
         ['effects', ['font', ['size', '1.27', '1.27']]]],
    ]
    if footprint:
        props.append(['property', ('__s__', 'Footprint'), ('__s__', footprint),
                      ['at', '0', '0', '0'],
                      ['effects', ['font', ['size', '1.27', '1.27']], ['hide', 'yes']]])
    pin_lines = []
    for p in pins:
        px, py = x + p['x'], y - p['y']
        pin_lines.append(['pin', ('__s__', p['num']), ['uuid', U()]])
        net = netmap.get(p['num'], None)
        if net is None:
            ncs.append((px, py))
        else:
            add_label(net, px, py, p['a'])
    comps.append(['symbol', ['lib_id', ('__s__', key)],
        ['at', f"{x:.4f}", f"{y:.4f}", '0'], ['unit', str(unit)],
        ['exclude_from_sim', 'no'], ['in_bom', 'yes'], ['on_board', 'yes'], ['dnp', 'no'],
        ['uuid', ('__s__', uid)]] + props + pin_lines +
        [['instances', ['project', ('__s__', PROJECT),
                        ['path', ('__s__', f"/{ROOT_UUID}"), ['reference', ('__s__', ref)], ['unit', str(unit)]]]]])

FP_R = "Resistor_SMD:R_0805_2012Metric"
FP_C = "Capacitor_SMD:C_0805_2012Metric"
FP_CP = "Capacitor_THT:CP_Radial_D6.3mm_P2.50mm"
FP_FUSE = "Fuse:Fuse_1812_4532Metric"

# ============ 1. 电源 ============
add_comp("J1", "Connector_Generic", "Conn_01x15", "SATA_Power", 30, 255,
         {**{str(i): None for i in (1, 2, 3)},
          **{str(i): 'GND' for i in (4, 5, 6, 10, 11, 12)},
          **{str(i): '+5V_IN' for i in (7, 8, 9)},
          **{str(i): '+12V_IN' for i in (13, 14, 15)}},
         footprint="Connector_SATA_SAS:SATA_Amphenol_10029364-001LF_Horizontal")
add_comp("F1", "Device", "Polyfuse", "PTC_3A_hold", 75, 262, {'1': '+12V_IN', '2': '+12V_SW'}, FP_FUSE)
add_comp("D1", "Device", "D_Schottky", "SS34", 105, 262, {'2': '+12V_SW', '1': '+12V'},
         "Diode_SMD:D_SMA")
add_comp("F2", "Device", "Polyfuse", "PTC_1A", 75, 244, {'1': '+5V_IN', '2': '+5V_SW'}, FP_FUSE)
add_comp("D2", "Device", "D_Schottky", "B5819W", 105, 244, {'2': '+5V_SW', '1': '+5V'},
         "Diode_SMD:D_SOD-123")
add_comp("D3", "Device", "D_Schottky", "B5819W", 135, 244, {'2': 'VBUS', '1': '+5V'},
         "Diode_SMD:D_SOD-123")
add_comp("U1", "Regulator_Linear", "AMS1117-3.3", "AMS1117-3.3", 170, 251,
         {'3': '+5V', '2': '+3V3', '1': 'GND'}, "Package_TO_SOT_SMD:SOT-223-3_TabPin2")
add_comp("C1", "Device", "C_Polarized", "100uF/16V", 205, 262, {'1': '+12V', '2': 'GND'}, FP_CP)
add_comp("C2", "Device", "C_Polarized", "470uF/10V", 205, 244, {'1': '+5V', '2': 'GND'}, FP_CP)
add_comp("C3", "Device", "C", "10uF/25V", 235, 262, {'1': '+12V', '2': 'GND'}, FP_C)
add_comp("C4", "Device", "C", "10uF", 235, 244, {'1': '+5V', '2': 'GND'}, FP_C)
add_comp("C5", "Device", "C", "10uF", 265, 244, {'1': '+3V3', '2': 'GND'}, FP_C)
add_flag('+12V', 30, 274)
add_flag('+5V', 130, 274)
add_flag('GND', 300, 274)

# ============ 2. ESP32-S3 ============
ESP_NETS = {
    'EN': 'RESET', 'IO0': 'BOOT', 'IO1': 'ADC_12V', 'IO2': 'ADC_5V', 'IO3': None,
    'IO4': 'ADC_3V3', 'IO5': 'FAN1_PWM', 'IO6': 'FAN2_PWM', 'IO7': 'FAN3_PWM',
    'IO8': 'FAN4_PWM', 'IO9': 'FAN5_PWM', 'IO10': 'FAN6_PWM', 'IO11': 'FAN7_PWM',
    'IO12': 'FAN8_PWM', 'IO13': 'FAN1_TACH', 'IO14': 'FAN2_TACH', 'IO15': 'FAN3_TACH',
    'IO16': 'DS18B20_DQ', 'IO17': 'I2C_SDA', 'IO18': 'I2C_SCL', 'IO21': 'FAN4_TACH',
    'IO38': 'FAN5_TACH', 'IO39': 'FAN6_TACH', 'IO40': 'FAN7_TACH', 'IO41': 'FAN8_TACH',
    'IO42': 'SPI_SCK', 'RXD0': 'SPI_CS', 'TXD0': 'SPI_MOSI', 'IO45': 'WS2812B_DI',
    'IO46': None, 'IO47': 'BTN_WIFI_CFG', 'IO48': 'SPI_DC',
    'IO35': None, 'IO36': None, 'IO37': None,
    'USB_D-': 'USB_DN', 'USB_D+': 'USB_DP', '3V3': '+3V3', 'GND': 'GND',
}
# netmap 按"引脚名"转"引脚号"：生成时直接传 name→net，由 add_comp_esp 处理
embed('RF_Module', 'ESP32-S3-WROOM-1')
esp_units = _units_cache['RF_Module:ESP32-S3-WROOM-1']
esp_pins = get_pins(esp_units, 1)
esp_netmap = {}
for p in esp_pins:
    net = ESP_NETS.get(p['name'], None)
    esp_netmap[p['num']] = net
add_comp("U2", "RF_Module", "ESP32-S3-WROOM-1", "ESP32-S3-WROOM-1-N16R8", 90, 170,
         esp_netmap, "RF_Module:ESP32-S3-WROOM-1")
# EN / BOOT
add_comp("R1", "Device", "R", "10k", 150, 196, {'1': '+3V3', '2': 'RESET'}, FP_R)
add_comp("SW1", "Switch", "SW_Push", "RST", 150, 208, {'1': 'RESET', '2': 'GND'},
         "Button_Switch_SMD:SW_SPST_PTS645Sx43SMTR92")
add_comp("C6", "Device", "C", "100nF", 170, 208, {'1': 'RESET', '2': 'GND'}, FP_C)
add_comp("R2", "Device", "R", "10k", 190, 196, {'1': '+3V3', '2': 'BOOT'}, FP_R)
add_comp("SW2", "Switch", "SW_Push", "BOOT", 190, 208, {'1': 'BOOT', '2': 'GND'},
         "Button_Switch_SMD:SW_SPST_PTS645Sx43SMTR92")
# ESP32 去耦 ×4（示意，BOM 要求 ≥8 分布 VDD）
for i, cx in enumerate((125, 140, 155, 170)):
    add_comp(f"C{7+i}", "Device", "C", "100nF", cx, 132, {'1': '+3V3', '2': 'GND'}, FP_C)

# ============ 3. 74AHCT125 ×2 + PWM 下拉 ============
embed('74xx', '74AHCT125')
ahct_units = _units_cache['74xx:74AHCT125']
for chip, (uref, bx) in enumerate((("U3", 235), ("U4", 300))):
    for u in range(1, 5):
        fan = chip * 4 + u  # Fan1..8
        pins = ahct_units[u][0]
        nm = {}
        for p in pins:
            if p['a'] == 0:    nm[p['num']] = f"FAN{fan}_PWM"       # A 输入
            elif p['a'] == 180: nm[p['num']] = f"FAN{fan}_PWM_OUT"  # Y 输出
            else:               nm[p['num']] = 'GND'                 # OE
        xx = bx + ((u - 1) % 2) * 22
        yy = 160 - ((u - 1) // 2) * 18
        add_comp(uref, "74xx", "74AHCT125", "74AHCT125", xx, yy, nm,
                 "Package_SO:SOIC-14_3.9x8.7mm_P1.27mm", unit=u)
    # 单元5（电源）
    nm5 = {}
    for p in ahct_units[5][0]:
        nm5[p['num']] = '+5V' if p['name'].upper().startswith('V') else 'GND'
    add_comp(uref, "74xx", "74AHCT125", "74AHCT125", bx, 118, nm5,
             "Package_SO:SOIC-14_3.9x8.7mm_P1.27mm", unit=5)
    add_comp(f"C{11+chip}", "Device", "C", "100nF", bx - 15, 118, {'1': '+5V', '2': 'GND'}, FP_C)
# PWM 下拉 ×8（H-17）
for n in range(1, 9):
    add_comp(f"R{3+n}", "Device", "R", "10k", 360, 115 + (n - 1) * 12.7,
             {'1': f"FAN{n}_PWM", '2': 'GND'}, FP_R)

# ============ 4. 风扇座 J3~J10 ============
for n in range(1, 9):
    add_comp(f"J{2+n}", "Connector_Generic", "Conn_01x04", f"Fan{n}_4Pin", 20 + (n - 1) * 22, 66,
             {'1': 'GND', '2': '+12V', '3': f"FAN{n}_TACH_IN", '4': f"FAN{n}_PWM_OUT"},
             "Connector_Molex:Molex_KK-254_AE-6410-04A_1x04_P2.54mm_Vertical")

# ============ 5. Tach 网络 ×8（3R+1C） ============
for n in range(1, 9):
    gx = 20 + ((n - 1) % 4) * 46
    gy = 96 if n <= 4 else 126
    rn = 12 + (n - 1) * 4  # R12..R43
    add_comp(f"R{rn}",   "Device", "R", "10k", gx,      gy, {'1': '+5V', '2': f"FAN{n}_TACH_IN"}, FP_R)
    add_comp(f"R{rn+1}", "Device", "R", "10k", gx + 10, gy, {'1': f"FAN{n}_TACH_IN", '2': f"FAN{n}_TACH"}, FP_R)
    add_comp(f"R{rn+2}", "Device", "R", "10k", gx + 20, gy, {'1': f"FAN{n}_TACH", '2': 'GND'}, FP_R)
    add_comp(f"C{12+n}", "Device", "C", "1nF", gx + 30, gy, {'1': f"FAN{n}_TACH", '2': 'GND'}, FP_C)

# ============ 6. ADC 分压 ============
add_comp("R44", "Device", "R", "100k", 20, 196, {'1': '+12V', '2': 'ADC_12V'}, FP_R)
add_comp("R45", "Device", "R", "20k",  20, 208, {'1': 'ADC_12V', '2': 'GND'}, FP_R)
add_comp("R46", "Device", "R", "47k",  45, 196, {'1': '+5V', '2': 'ADC_5V'}, FP_R)
add_comp("R47", "Device", "R", "10k",  45, 208, {'1': 'ADC_5V', '2': 'GND'}, FP_R)
add_comp("R48", "Device", "R", "47k",  70, 196, {'1': '+3V3', '2': 'ADC_3V3'}, FP_R)
add_comp("R49", "Device", "R", "10k",  70, 208, {'1': 'ADC_3V3', '2': 'GND'}, FP_R)

# ============ 7. I2C / DS18B20 / WS2812 / WiFi按键 ============
add_comp("R50", "Device", "R", "4.7k", 100, 196, {'1': '+3V3', '2': 'I2C_SDA'}, FP_R)
add_comp("R51", "Device", "R", "4.7k", 100, 208, {'1': '+3V3', '2': 'I2C_SCL'}, FP_R)
add_comp("U5", "Sensor", "BME280", "BME280", 125, 208,
         {'8': '+3V3', '6': '+3V3', '1': 'GND', '7': 'GND',
          '3': 'I2C_SDA', '4': 'I2C_SCL', '5': 'GND', '2': '+3V3'},
         "Package_LGA:Bosch_LGA-8_2x2.5mm_P0.65mm_ClockwisePinNumbering")
add_comp("R52", "Device", "R", "4.7k", 150, 220, {'1': '+3V3', '2': 'DS18B20_DQ'}, FP_R)
add_comp("J11", "Connector_Generic", "Conn_01x03", "DS18B20_1", 165, 208,
         {'1': 'GND', '2': 'DS18B20_DQ', '3': '+3V3'},
         "Connector_JST:JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical")
add_comp("J12", "Connector_Generic", "Conn_01x03", "DS18B20_2", 185, 208,
         {'1': 'GND', '2': 'DS18B20_DQ', '3': '+3V3'},
         "Connector_JST:JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical")
add_comp("R53", "Device", "R", "33R", 210, 196, {'1': 'WS2812B_DI', '2': 'WS2812_DIN'}, FP_R)
add_comp("LED1", "LED", "WS2812B-2020", "WS2812B-2020", 225, 208,
         {'4': '+3V3', '2': 'GND', '3': 'WS2812_DIN', '1': None},
         "LED_SMD:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm")
add_comp("R54", "Device", "R", "10k", 250, 196, {'1': '+3V3', '2': 'BTN_WIFI_CFG'}, FP_R)
add_comp("SW3", "Switch", "SW_Push", "WiFi_CFG", 250, 208, {'1': 'BTN_WIFI_CFG', '2': 'GND'},
         "Button_Switch_SMD:SW_SPST_PTS645Sx43SMTR92")

# ============ 8. USB-C + ESD ============
USB_NETS = {}
for pn in ('A4', 'A9', 'B4', 'B9'): USB_NETS[pn] = 'VBUS'
for pn in ('A1', 'A12', 'B1', 'B12', 'SH'): USB_NETS[pn] = 'GND'
USB_NETS.update({'A5': 'CC1', 'B5': 'CC2', 'A6': 'USB_DP', 'B6': 'USB_DP',
                 'A7': 'USB_DN', 'B7': 'USB_DN'})
for pn in ('A2', 'A3', 'A8', 'A10', 'A11', 'B2', 'B3', 'B8', 'B10', 'B11'):
    USB_NETS[pn] = None
add_comp("J2", "Connector", "USB_C_Receptacle", "USB_C_16P", 290, 232, USB_NETS,
         "Connector_USB:USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal")
add_comp("U6", "Power_Protection", "USBLC6-2P6", "USBLC6-2SC6", 340, 232,
         {'1': 'USB_DN', '6': 'USB_DN', '3': 'USB_DP', '4': 'USB_DP',
          '2': 'GND', '5': '+5V'}, "Package_TO_SOT_SMD:SOT-23-6")
add_comp("R55", "Device", "R", "5.1k", 320, 196, {'1': 'CC1', '2': 'GND'}, FP_R)
add_comp("R56", "Device", "R", "5.1k", 335, 196, {'1': 'CC2', '2': 'GND'}, FP_R)
add_comp("C22", "Device", "C", "10uF", 370, 232, {'1': 'VBUS', '2': 'GND'}, FP_C)
add_comp("C23", "Device", "C", "100nF", 385, 232, {'1': 'VBUS', '2': 'GND'}, FP_C)

# ============ 9. 屏幕接口 J15 + 安装孔 ============
add_comp("J13", "Connector_Generic", "Conn_01x08", "LCD_J13", 350, 276,
         {'1': '+3V3', '2': 'GND', '3': 'SPI_SCK', '4': 'SPI_MOSI', '5': 'SPI_CS',
          '6': 'SPI_DC', '7': 'I2C_SDA', '8': 'I2C_SCL'},
         "Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical")
for i, (mx, my) in enumerate(((395, 60), (395, 280), (15, 280), (15, 30))):
    comps.append(['symbol', ['lib_id', ('__s__', 'Mechanical:MountingHole')],
        ['at', f"{mx}", f"{my}", '0'], ['unit', '1'],
        ['exclude_from_sim', 'no'], ['in_bom', 'yes'], ['on_board', 'yes'], ['dnp', 'no'],
        ['uuid', U()],
        ['property', ('__s__', 'Reference'), ('__s__', f"H{i+1}"),
         ['at', f"{mx}", f"{my}", '0'], ['effects', ['font', ['size', '1.27', '1.27']]]],
        ['property', ('__s__', 'Value'), ('__s__', 'MountingHole'),
         ['at', f"{mx}", f"{my - 3:.4f}", '0'], ['effects', ['font', ['size', '1.27', '1.27']]]],
        ['instances', ['project', ('__s__', PROJECT),
                       ['path', ('__s__', f"/{ROOT_UUID}"), ['reference', ('__s__', f"H{i+1}")], ['unit', '1']]]]])
embed('Mechanical', 'MountingHole')

# ---------------- 输出 ----------------
def w(s):
    out.append(s)

def dump_node(node):
    def walk(n):
        if isinstance(n, list):
            return '(' + ' '.join(walk(c) for c in n) + ')'
        if isinstance(n, tuple):
            return '"%s"' % n[1]
        return str(n)
    return walk(node)

out = []
w('(kicad_sch')
w('  (version 20231120)')
w('  (generator "eeschema")')
w(f'  (uuid "{ROOT_UUID}")')
w('  (paper "A2")')
w('  (title_block')
w('    (title "Smart Fan Controller v1.2 - KiCad Reference (NOT authoritative)")')
w('    (date "2026-08-26")')
w('    (rev "v1.2-ref")')
w('    (comment 1 "Reference drawing only. LCEDA project is the single source of truth (D6).")')
w('    (comment 2 "Per hardware/docs/remediation-plan-v1.2.md v1.2.2")')
w('  )')
w('  (lib_symbols')
for s in lib_syms:
    w('    ' + dump_node(s))
w('  )')
for s in comps:
    w('  ' + dump_node(s))
for (x, y) in ncs:
    w(f'  (no_connect (at {x:.4f} {y:.4f}) (uuid "{str(uuid.uuid4())}"))')
for (net, x, y, rot) in labels:
    w(f'  (global_label "{net}" (shape input) (at {x:.4f} {y:.4f} {rot}) '
      f'(effects (font (size 1.27 1.27)) (justify left)) (uuid "{str(uuid.uuid4())}"))')
w('  (sheet_instances')
w('    (path "/" (page "1"))')
w('  )')
w(')')
open(OUT, 'w', encoding='utf-8').write('\n'.join(out))
print(f"OK: {OUT}")
print(f"components={len(comps)} labels={len(labels)} nc={len(ncs)} lib_syms={len(lib_syms)}")
