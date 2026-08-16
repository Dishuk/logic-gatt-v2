MOBILE := logic-gatt-mobile-app
DESKTOP := logic-gatt-desktop-app

.PHONY: help install install-mobile install-desktop \
        start ios android apk apk-release lint \
        dev hmr build gen-theme \
        test typecheck dist

help:
	@echo "logic-gatt-v2 targets:"
	@echo "  make install          - install all deps (desktop + mobile, incl. git modules)"
	@echo ""
	@echo "  Mobile (Expo SDK 57 - BLE GATT server / peripheral):"
	@echo "  make start            - expo dev server"
	@echo "  make ios              - build + run iOS dev build (native BLE)"
	@echo "  make android          - build + run Android dev build (native BLE)"
	@echo "  make apk              - build + install RELEASE APK (prod-like local test)"
	@echo "  make lint             - expo lint"
	@echo ""
	@echo "  Desktop (Electrobun - controller / GATT client):"
	@echo "  make dev              - start the desktop app (electrobun dev --watch)"
	@echo "  make hmr              - dev + Vite HMR (frontend hot reload)"
	@echo "  make build            - build canary installer -> artifacts/canary-win-x64-LogicGATT-Setup-canary.zip (unzip + run)"
	@echo ""
	@echo "  Shared:"
	@echo "  make gen-theme        - regenerate desktop theme.css from shared/tokens.ts"
	@echo ""
	@echo "  Checks:"
	@echo "  make test             - run desktop Vitest suite"
	@echo "  make typecheck        - type-check both apps (tsc --noEmit)"
	@echo ""
	@echo "  Prod builds:"
	@echo "  make dist             - build both LOCAL prod artifacts (install APK on device + desktop canary installer)"
	@echo "  make apk-release      - build the release APK FILE (no device needed; Gradle)"

# --- setup ---
install: install-mobile install-desktop

install-mobile:
	cd $(MOBILE) && npm install

install-desktop:
	cd $(DESKTOP) && bun install

# --- mobile (Expo) ---
start:
	cd $(MOBILE) && npx expo start

ios:
	cd $(MOBILE) && npx expo run:ios

android:
	cd $(MOBILE) && npx expo run:android

# Release-variant APK (Hermes, minifiable), debug-key-signed so it installs for
# local prod-like testing. Needs a connected device/emulator; the artifact also
# lands at android/app/build/outputs/apk/release/app-release.apk
apk:
	cd $(MOBILE) && npx expo run:android --variant release

lint:
	cd $(MOBILE) && npm run lint

# --- desktop (Electrobun / Bun) ---
# `dev` = electrobun --watch (Bun main process only); `hmr` = adds Vite HMR for
# the frontend.
dev:
	cd $(DESKTOP) && bun run dev

hmr:
	cd $(DESKTOP) && bun run dev:hmr

# Canary installer. The DISTRIBUTABLE is the ZIP in artifacts/ — the bare
# build/.../*.exe is only a ~400KB extractor stub that needs its `.installer/`
# payload, so ship/run the zip (unzip, then run LogicGATT-Setup.exe):
#   artifacts/canary-win-x64-LogicGATT-Setup-canary.zip
build:
	cd $(DESKTOP) && bun run build:canary

# --- shared (design tokens) ---
# Regenerate the desktop's theme.css from the canonical shared/tokens.ts.
gen-theme:
	bun shared/build-css.ts

# --- checks ---
# `test` = desktop Vitest (only the desktop app has tests). `typecheck` runs
# tsc --noEmit across both apps.
test:
	cd $(DESKTOP) && bun run test

typecheck:
	cd $(MOBILE) && npm run typecheck
	cd $(DESKTOP) && bun run typecheck

# --- prod builds ---
# dist: both apps' prod-like LOCAL artifacts (canary desktop installer + APK
# installed on a connected device).
dist: apk build

# apk-release: build the release APK FILE (no device). Syncs the version from
# app.json via prebuild, then Gradle assembleRelease. Needs the Android SDK + a
# JDK. Output: android/app/build/outputs/apk/release/app-release.apk
#
# ABIS restricts the packaged native libs to real-phone architectures only —
# dropping the emulator-only x86/x86_64 sets (~55MB) that Expo's default fat APK
# would otherwise bundle. Passed as a build-time -P override so it survives the
# prebuild regenerating android/gradle.properties (which lists all four). Override
# with `make apk-release ABIS=arm64-v8a` for a single-ABI build.
ABIS ?= arm64-v8a,armeabi-v7a
apk-release:
	cd $(MOBILE) && npx expo prebuild --platform android
	cd $(MOBILE)/android && ./gradlew assembleRelease -PreactNativeArchitectures=$(ABIS)

# Optional local-only targets (personal, gitignored) — silently ignored if absent.
-include .local/release/release.mk
