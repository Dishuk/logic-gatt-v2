# BLE bridge backend. Needs `uv` on PATH (https://docs.astral.sh/uv/) — it fetches the
# pinned CPython, so no system Python install is required.
#
#   make venv   - dev environment
#   make run    - run from source
#   make build  - freeze to ../bin/ (per-OS; PyInstaller cannot cross-compile)
#   make clean

.PHONY: venv run build clean

# bless 0.3.0 cannot resolve on 3.12+ (see requirements.txt).
PYTHON_VERSION = 3.11
VENV = venv
BIN_DIR = ../bin
NAME = logicgatt-blebridge

ifeq ($(OS),Windows_NT)
    PY = $(VENV)/Scripts/python.exe
    EXE = $(NAME).exe
else
    PY = $(VENV)/bin/python
    EXE = $(NAME)
endif

# Stamp rather than the venv dir itself: `venv` as both target and directory is
# circular, and re-running must not fail on an existing environment.
STAMP = $(VENV)/.deps-installed

venv: $(STAMP)

$(STAMP): requirements.txt
	@command -v uv >/dev/null 2>&1 || { echo "uv not found — install from https://docs.astral.sh/uv/"; exit 1; }
	uv venv --python $(PYTHON_VERSION) --clear $(VENV)
	uv pip install --python $(PY) -r requirements.txt
	@touch $(STAMP)

run: $(STAMP)
	$(PY) main.py

build: $(STAMP)
	uv pip install --python $(PY) pyinstaller
	$(PY) -m PyInstaller --clean --noconfirm blebridge.spec
	@mkdir -p $(BIN_DIR)
	cp dist/$(EXE) $(BIN_DIR)/$(EXE)
	@echo "built $(BIN_DIR)/$(EXE)"

clean:
	rm -rf $(VENV) __pycache__ build dist
