.PHONY: build test gen-corpus run-conformer run-impl diff-impl serve-site clean clean-results clean-corpus

build:
	$(MAKE) -C conformer build
	$(MAKE) -C corpus-gen build

test:
	node --test site/build.test.js
	$(MAKE) -C results test
	$(MAKE) -C corpus-gen test
	$(MAKE) -C conformer test
	$(MAKE) -C impls test

gen-corpus:
	$(MAKE) -C corpus-gen gen

run-conformer:
	$(MAKE) -C conformer run
	node site/build.js results/data

run-impl:
	@test -n "$(IMPL)" -a -n "$(TEST)" || { echo "Usage: make run-impl IMPL=<name> TEST=<corpus-path>"; exit 1; }
	@node conformer/src/run-impl.js $(IMPL) $(TEST)

diff-impl:
	@test -n "$(IMPL)" -a -n "$(TEST)" || { echo "Usage: make diff-impl IMPL=<name> TEST=<corpus-path>"; exit 1; }
	@node conformer/src/diff-impl.js $(IMPL) $(TEST)

serve-site:
	node site/build.js results/data
	@python3 -m http.server 8000 -d site & \
		PID=$$!; \
		trap "kill $$PID 2>/dev/null" EXIT; \
		sleep 0.5; \
		echo "Serving site at http://localhost:8000 (pid $$PID)"; \
		open http://localhost:8000; \
		wait $$PID

clean-corpus:
	@find corpus -mindepth 1 -maxdepth 1 -type d ! -name '0' -exec rm -rf {} +

clean-results:
	rm -rf results/data

clean:
	$(MAKE) -C conformer clean
	$(MAKE) -C corpus-gen clean
	$(MAKE) -C impls clean
