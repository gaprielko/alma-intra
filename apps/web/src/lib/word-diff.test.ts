import { wordDiff } from './word-diff';

describe('wordDiff', () => {
  it('marks what was added and removed, word by word', () => {
    expect(wordDiff('Prvé stretnutie u vás', 'Prvé online stretnutie')).toEqual([
      { kind: 'same', text: 'Prvé ' },
      { kind: 'added', text: 'online ' },
      { kind: 'same', text: 'stretnutie' },
      { kind: 'removed', text: 'u vás' },
    ]);
  });

  it('handles an empty side', () => {
    expect(wordDiff('', 'nové')).toEqual([{ kind: 'added', text: 'nové' }]);
    expect(wordDiff('staré', '')).toEqual([{ kind: 'removed', text: 'staré' }]);
    expect(wordDiff('', '')).toEqual([]);
  });
});
