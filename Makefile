# Local build & run tasks for Tessera.
# Run `make` (or `make help`) to list targets.
# Web tasks need Node; desktop tasks need the Rust toolchain (https://rustup.rs).

IMAGE ?= tessera-web
PORT  ?= 8080
ICONS := src-tauri/icons/icon.icns

.DEFAULT_GOAL := help
.PHONY: help install dev build preview test icons desktop-dev desktop \
        docker-build docker-run docker-dist clean distclean require-rust

help: ## show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z0-9_-]+:.*##/{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

install: node_modules ## install JS dependencies (npm ci)

# Reinstall only when the lockfile changes; touch so the marker tracks it.
node_modules: package-lock.json
	npm ci
	@touch node_modules

dev: node_modules ## start the web dev server (hot reload)
	npm run dev

build: node_modules ## build the static web bundle into dist/
	npm run build

preview: build ## serve the built bundle locally (with COOP/COEP headers)
	npm run preview

test: node_modules ## run unit tests
	npm test

icons: $(ICONS) ## generate app icons from src-tauri/app-icon.png

# Regenerate icons only when the source PNG is newer (or they are missing).
$(ICONS): src-tauri/app-icon.png node_modules
	npx tauri icon $<

desktop-dev: node_modules $(ICONS) require-rust ## run the desktop app (Tauri dev)
	npm run tauri:dev

desktop: node_modules $(ICONS) require-rust ## build desktop installers (src-tauri/target/release/bundle)
	npm run tauri:build

docker-build: ## build the web container image ($(IMAGE))
	docker build -t $(IMAGE) .

docker-run: docker-build ## build then serve the web image at http://localhost:$(PORT)
	docker run --rm -p $(PORT):80 $(IMAGE)

docker-dist: ## build the static bundle in Docker (reproducible) and export it to dist/
	docker build --target export --output type=local,dest=dist .

clean: ## remove build output and generated icons
	rm -rf dist
	-find src-tauri/icons -mindepth 1 ! -name README.md -delete 2>/dev/null

distclean: clean ## clean + remove node_modules and the Rust build target
	rm -rf node_modules src-tauri/target

require-rust:
	@command -v cargo >/dev/null 2>&1 || { \
	  echo "Error: Rust toolchain not found. Install it from https://rustup.rs and retry."; \
	  exit 1; }
