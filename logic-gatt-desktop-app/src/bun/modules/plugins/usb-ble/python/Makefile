.PHONY: start install clean

VENV = venv

ifeq ($(OS),Windows_NT)
    PYTHON = $(VENV)/Scripts/python.exe
    PIP = $(VENV)/Scripts/pip.exe
else
    PYTHON = $(VENV)/bin/python
    PIP = $(VENV)/bin/pip
endif

start: $(VENV)
	$(PYTHON) main.py

install: $(VENV)
	@echo "Dependencies installed"

$(VENV):
	python -m venv $(VENV)
	$(PIP) install git+https://github.com/gwangyi/pysetupdi.git
	$(PIP) install -r requirements.txt

clean:
ifeq ($(OS),Windows_NT)
	if exist $(VENV) rmdir /s /q $(VENV)
	if exist __pycache__ rmdir /s /q __pycache__
else
	rm -rf $(VENV) __pycache__ *.pyc
endif
