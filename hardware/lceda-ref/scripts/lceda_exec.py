#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lceda_exec.py — 向 EasyEDA Pro 桥接服务发送 JS 代码并打印结果
用法: python lceda_exec.py <file.js>   （或 --code 'inline js'）"""
import json, sys, urllib.request

PORT = 49620

def execute(code, timeout=60):
    req = urllib.request.Request(
        f"http://localhost:{PORT}/execute",
        data=json.dumps({"code": code}).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

if __name__ == "__main__":
    if sys.argv[1] == "--code":
        code = sys.argv[2]
    else:
        code = open(sys.argv[1], encoding="utf-8").read()
    res = execute(code)
    print(json.dumps(res, ensure_ascii=False, indent=1))
