# -*- mode: python ; coding: utf-8 -*-
"""
Freeze main.py into a single self-contained executable.

bless and bleak reach their platform BLE bindings through runtime string imports
(`_import_ns_module("Windows.Foundation")`), which PyInstaller's static analysis
cannot follow — hence the explicit collect_submodules below. Getting these wrong
produces a binary that builds fine and fails on first use.
"""

import sys

from PyInstaller.utils.hooks import collect_dynamic_libs, collect_submodules

hidden = []
binaries = []
for pkg in ("bless", "bleak", "websockets"):
    hidden += collect_submodules(pkg)

if sys.platform == "win32":
    platform_pkgs = ("bleak_winrt", "winrt", "pysetupdi", "win32more")
elif sys.platform.startswith("linux"):
    # bless uses dbus-next, bleak uses dbus-fast — both are needed, and dbus-fast
    # ships compiled extensions that must be collected as binaries.
    platform_pkgs = ("dbus_next", "dbus_fast")
else:
    platform_pkgs = ()

for pkg in platform_pkgs:
    try:
        hidden += collect_submodules(pkg)
        binaries += collect_dynamic_libs(pkg)
    except Exception:
        pass

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=binaries,
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
