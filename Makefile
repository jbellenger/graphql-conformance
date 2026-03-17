.PHONY: build test clean

build:
	$(MAKE) -C conformer build
	$(MAKE) -C conformer/corpus-gen build

test:
	$(MAKE) -C conformer/corpus-gen test
	$(MAKE) -C conformer test

clean:
	$(MAKE) -C conformer clean
	$(MAKE) -C conformer/corpus-gen clean
