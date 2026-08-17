# dialogmapper build.
#
# The frontend is compiled into internal/web/dist and embedded by go:embed, so
# `make build` produces one self-contained executable with no runtime
# dependencies — not even a Node install on the target machine.

BINARY  := dialogmapper
VERSION ?= v0.0.15
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all build web website go-build dev test test-e2e e2e-browser lint clean install release

all: build

## build: compile the frontend, then embed it in the binary
build: web go-build

web:
	cd web && npm install --no-audit --no-fund && npm run build

website:
	cd website && npm install --no-audit --no-fund && npm run build

go-build:
	go build -ldflags "$(LDFLAGS)" -o $(BINARY) .

## dev: run the Go server and the Vite dev server together.
## Vite proxies /api and /ws to :7373, so the frontend hot-reloads against
## real data instead of a mock that drifts from the Go implementation.
dev:
	@echo "Go server on :7373, Vite on :5173 — open http://localhost:5173"
	@( go run . start --port 7373 & cd web && npm run dev ) ; wait

test:
	go test ./...
	cd web && npm run typecheck

## test-e2e: drive the built binary in a real browser.
## Depends on `build` because the tests run the embedded frontend, not the dev
## server — three shipped bugs were in exactly that gap between the two.
test-e2e: build
	cd e2e && npm install --no-audit --no-fund && npm test

## e2e-browser: one-off Chromium download for the e2e suite.
## In CI use `npx playwright install --with-deps chromium` to pull system libs.
e2e-browser:
	cd e2e && npm install --no-audit --no-fund && npm run install-browser

lint:
	gofmt -l main.go internal/
	go vet ./...

install: build
	go install -ldflags "$(LDFLAGS)" .

## release: cross-compile. Pure-Go SQLite (modernc.org/sqlite) means no cgo,
## so these all build from one machine without a cross toolchain.
release: web
	@mkdir -p dist
	@for target in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64; do \
		os=$${target%/*}; arch=$${target#*/}; \
		ext=$$([ "$$os" = "windows" ] && echo ".exe" || echo ""); \
		echo "  $$os/$$arch"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
			go build -ldflags "$(LDFLAGS)" -o dist/$(BINARY)-$$os-$$arch$$ext . ; \
	done

clean:
	rm -rf $(BINARY) dist web/node_modules internal/web/dist website/dist website/node_modules \
		e2e/node_modules e2e/test-results e2e/playwright-report
	@mkdir -p internal/web/dist
	@echo '<!doctype html><title>dialogmapper</title><p>Run `make web` to build the frontend.' \
		> internal/web/dist/index.html
