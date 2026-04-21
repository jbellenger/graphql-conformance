'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSingleFileTar } = require('./docker');

function buildTarEntry(content, { sizeField } = {}) {
  const contentBuf = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512, 0);
  const sizeOctal = (sizeField != null ? sizeField : contentBuf.length.toString(8)).padStart(11, '0');
  header.write(sizeOctal + ' ', 124, 'ascii');
  const contentBlock = Buffer.alloc(Math.ceil(contentBuf.length / 512) * 512, 0);
  contentBuf.copy(contentBlock, 0);
  return Buffer.concat([header, contentBlock]);
}

describe('parseSingleFileTar', () => {
  it('extracts content matching the size field', () => {
    const tar = buildTarEntry('17.0.0-alpha.14');
    assert.equal(parseSingleFileTar(tar), '17.0.0-alpha.14');
  });

  it('ignores padding bytes after the declared size', () => {
    const tar = buildTarEntry('25.0');
    assert.equal(parseSingleFileTar(tar), '25.0');
  });

  it('returns null for buffers smaller than one tar block', () => {
    assert.equal(parseSingleFileTar(Buffer.alloc(100)), null);
  });

  it('returns null for a null buffer', () => {
    assert.equal(parseSingleFileTar(null), null);
  });

  it('returns null when the size field is zero', () => {
    const tar = buildTarEntry('', { sizeField: '0' });
    assert.equal(parseSingleFileTar(tar), null);
  });

  it('returns null when the size field is not a valid octal number', () => {
    const tar = buildTarEntry('ignored', { sizeField: 'notoct' });
    assert.equal(parseSingleFileTar(tar), null);
  });

  it('decodes UTF-8 content correctly', () => {
    const tar = buildTarEntry('v1.2.3-βeta');
    assert.equal(parseSingleFileTar(tar), 'v1.2.3-βeta');
  });
});
