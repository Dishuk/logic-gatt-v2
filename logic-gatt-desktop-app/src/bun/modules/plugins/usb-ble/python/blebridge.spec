# -*- mode: python ; coding: utf-8 -*-
"""
Freeze main.py into a single self-contained executable.

bless and bleak reach their platform BLE bindings through runtime string imports
(`_import_ns_module("Windows.Foundation")`), which PyInstaller's static analysis
cannot follow — hence the explicit collect_submodules below. Getting these wrong
produces a binary that builds fine and fails on first use.
"""

import sys

from PyInstaller.utils.hooks import collect_submodules

hidden = []
for pkg in ("bless", "bleak", "websockets"):
    hidden += collect_submodules(pkg)

if sys.platform == "win32":
    for pkg in ("bleak_winrt", "winrt", "pysetupdi", "win32more"):
        try:
            hidden += collect_submodules(pkg)
        except Exception:
            pass
elif sys.platform.startswith("linux"):
    hidden += collect_submodules("dbus_next")

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc_data"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="logicgatt-blebridge",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
