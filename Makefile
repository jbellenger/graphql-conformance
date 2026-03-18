.PHONY: build test gen-corpus run-conformer serve-site clean

build:
	$(MAKE) -C conformer build
	$(MAKE) -C conformer/corpus-gen build

test:
	$(MAKE) -C conformer/corpus-gen test
	$(MAKE) -C conformer test

gen-corpus:
	$(MAKE) -C conformer/corpus-gen gen

run-conformer:
	$(MAKE) -C conformer run

serve-site:
	node site/build.js conformer/results/data
	@echo "Serving site at http://localhost:8000"
	@open http://localhost:8000
	python3 -m http.server 8000 -d site

clean:
	$(MAKE) -C conformer clean
	$(MAKE) -C conformer/corpus-gen clean
