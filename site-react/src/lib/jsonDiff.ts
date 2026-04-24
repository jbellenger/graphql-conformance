// Line-based LCS diff over pretty-printed JSON. Ported from the legacy
// site/render.js; returns structured rows so React components can render
// without building HTML strings.

export type DiffRowMode = 'same' | 'added' | 'removed' | 'modified';

export interface DiffRow {
  leftText: string;
  rightText: string;
  mode: DiffRowMode;
}

export function buildJsonDiffRows(
  expected: unknown,
  actual: unknown,
): DiffRow[] {
  const leftLines = JSON.stringify(expected, null, 2).split('\n');
  const rightLines = JSON.stringify(actual, null, 2).split('\n');
  const ops = lcsOps(leftLines, rightLines);
  return pairOps(ops);
}

interface Op {
  type: 'same' | 'added' | 'removed';
  leftText: string;
  rightText: string;
}

function lcsOps(leftLines: string[], rightLines: string[]): Op[] {
  const dp: number[][] = Array.from({ length: leftLines.length + 1 }, () =>
    Array(rightLines.length + 1).fill(0),
  );
  for (let i = leftLines.length - 1; i >= 0; i -= 1) {
    for (let j = rightLines.length - 1; j >= 0; j -= 1) {
      if (leftLines[i] === rightLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < leftLines.length && j < rightLines.length) {
    if (leftLines[i] === rightLines[j]) {
      ops.push({ type: 'same', leftText: leftLines[i], rightText: rightLines[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'removed', leftText: leftLines[i], rightText: '' });
      i += 1;
    } else {
      ops.push({ type: 'added', leftText: '', rightText: rightLines[j] });
      j += 1;
    }
  }
  while (i < leftLines.length) {
    ops.push({ type: 'removed', leftText: leftLines[i], rightText: '' });
    i += 1;
  }
  while (j < rightLines.length) {
    ops.push({ type: 'added', leftText: '', rightText: rightLines[j] });
    j += 1;
  }
  return ops;
}

// Collapses contiguous removed/added runs into paired 'modified' rows, mirroring
// the legacy visual treatment. Unpaired extras stay as 'removed'/'added'.
function pairOps(ops: Op[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (op.type === 'same') {
      rows.push({ leftText: op.leftText, rightText: op.rightText, mode: 'same' });
      continue;
    }
    if (op.type === 'added') {
      rows.push({ leftText: '', rightText: op.rightText, mode: 'added' });
      continue;
    }

    // Start of a removed run. Gather subsequent removes and the following adds.
    const removedBlock: string[] = [];
    while (index < ops.length && ops[index].type === 'removed') {
      removedBlock.push(ops[index].leftText);
      index += 1;
    }
    const addedBlock: string[] = [];
    while (index < ops.length && ops[index].type === 'added') {
      addedBlock.push(ops[index].rightText);
      index += 1;
    }

    const paired = Math.min(removedBlock.length, addedBlock.length);
    for (let k = 0; k < paired; k += 1) {
      rows.push({
        leftText: removedBlock[k],
        rightText: addedBlock[k],
        mode: 'modified',
      });
    }
    for (let k = paired; k < removedBlock.length; k += 1) {
      rows.push({
        leftText: removedBlock[k],
        rightText: '',
        mode: 'removed',
      });
    }
    for (let k = paired; k < addedBlock.length; k += 1) {
      rows.push({
        leftText: '',
        rightText: addedBlock[k],
        mode: 'added',
      });
    }

    index -= 1; // compensate for the outer for-loop's increment
  }
  return rows;
}

// Character-level change markers: within a 'modified' row, highlight the
// contiguous changed middle portion (common prefix/suffix left plain).
export interface CharDiff {
  prefix: string;
  changed: string;
  suffix: string;
}

export function computeCharDiff(text: string, otherText: string): CharDiff {
  let prefix = 0;
  while (
    prefix < text.length &&
    prefix < otherText.length &&
    text[prefix] === otherText[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < text.length - prefix &&
    suffix < otherText.length - prefix &&
    text[text.length - 1 - suffix] === otherText[otherText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    prefix: text.slice(0, prefix),
    changed: text.slice(prefix, text.length - suffix),
    suffix: suffix > 0 ? text.slice(text.length - suffix) : '',
  };
}
