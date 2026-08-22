# BLE bridge backend. `uv` (provisioned by mise) fetches the pinned CPython, so no
# system Python install is needed.
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

venv: $(VENV)

$(VENV):
	uv venv --python $(PYTHON_VERSION) $(VENV)
	uv pip install --python $(PY) -r requirements.txt

run: $(VENV)
	$(PY) main.py

build: $(VENV)
	uv pip install --python $(PY) pyinstaller
	$(PY) -m PyInstaller --clean --noconfirm blebridge.spec
	@mkdir -p $(BIN_DIR)
	cp dist/$(EXE) $(BIN_DIR)/$(EXE)
	@echo "built $(BIN_DIR)/$(EXE)"

clean:
	rm -rf $(VENV) __pycache__ build dist
