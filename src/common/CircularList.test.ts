/**
 * Copyright (c) 2016 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { assert } from 'chai';
import { CircularList } from './CircularList';

describe('CircularList', () => {
  describe('push', () => {
    it('should push values onto the array', () => {
      const list = new CircularList<string>(5);
      list.push('1');
      list.push('2');
      list.push('3');
      list.push('4');
      list.push('5');
      assert.equal(list.get(0), '1');
      assert.equal(list.get(1), '2');
      assert.equal(list.get(2), '3');
      assert.equal(list.get(3), '4');
      assert.equal(list.get(4), '5');
    });

    it('should push old values from the start out of the array when max length is reached', () => {
      const list = new CircularList<string>(2);
      list.push('1');
      list.push('2');
      assert.equal(list.get(0), '1');
      assert.equal(list.get(1), '2');
      list.push('3');
      assert.equal(list.get(0), '2');
      assert.equal(list.get(1), '3');
      list.push('4');
      assert.equal(list.get(0), '3');
      assert.equal(list.get(1), '4');
    });
  });

  describe('maxLength', () => {
    it('should increase the size of the list', () => {
      const list = new CircularList<string>(2);
      list.push('1');
      list.push('2');
      assert.equal(list.get(0), '1');
      assert.equal(list.get(1), '2');
      list.maxLength = 4;
      list.push('3');
      list.push('4');
      assert.equal(list.get(0), '1');
      assert.equal(list.get(1), '2');
      assert.equal(list.get(2), '3');
      assert.equal(list.get(3), '4');
      list.push('wrapped');
      assert.equal(list.get(0), '2');
      assert.equal(list.get(1), '3');
      assert.equal(list.get(2), '4');
      assert.equal(list.get(3), 'wrapped');
    });

    it('should move only the wrap point of a list that has not wrapped', () => {
      const list = new CircularList<string>(6);
      const trims: number[] = [];
      list.onTrim(amount => trims.push(amount));
      list.push('1');
      list.push('2');
      list.push('3');
      // Grow, shrink and grow again, as a terminal whose row count changes
      // back and forth does to its scrollback ring.
      for (const maxLength of [9, 4, 3, 8, 5]) {
        list.maxLength = maxLength;
        assert.equal(list.maxLength, maxLength);
        assert.equal(list.length, 3);
        assert.deepEqual([list.get(0), list.get(1), list.get(2)], ['1', '2', '3']);
      }
      list.push('4');
      list.push('5');
      assert.equal(list.isFull, true);
      assert.deepEqual(trims, []);
      // The list wraps at the new maximum, not at an earlier one.
      list.push('6');
      assert.deepEqual(trims, [1]);
      assert.equal(list.length, 5);
      assert.deepEqual(
        [0, 1, 2, 3, 4].map(i => list.get(i)),
        ['2', '3', '4', '5', '6']
      );
      // ...and a wrapped list is still rebuilt in order.
      list.maxLength = 7;
      list.push('7');
      list.push('8');
      assert.deepEqual(trims, [1]);
      assert.deepEqual(
        [0, 1, 2, 3, 4, 5, 6].map(i => list.get(i)),
        ['2', '3', '4', '5', '6', '7', '8']
      );
    });

    it('should not expose popped values after growing in place', () => {
      const list = new CircularList<string>(4);
      list.push('1');
      list.push('2');
      list.push('3');
      list.pop();
      list.maxLength = 6;
      list.length = 4;
      assert.deepEqual(
        [0, 1, 2, 3].map(i => list.get(i)),
        ['1', '2', undefined, undefined]
      );
    });

    it('should rebuild a list whose start was trimmed', () => {
      const list = new CircularList<string>(5);
      for (const value of ['1', '2', '3', '4']) {
        list.push(value);
      }
      list.trimStart(2);
      list.maxLength = 7;
      assert.equal(list.length, 2);
      assert.deepEqual([list.get(0), list.get(1)], ['3', '4']);
      for (const value of ['5', '6', '7', '8', '9']) {
        list.push(value);
      }
      assert.equal(list.isFull, true);
      assert.deepEqual(
        [0, 1, 2, 3, 4, 5, 6].map(i => list.get(i)),
        ['3', '4', '5', '6', '7', '8', '9']
      );
    });

    it('should behave as a rebuilt list would for any sequence of operations', () => {
      // A plain array is the model: the list holds its last maxLength values.
      let seed = 0x6973;
      const next = (bound: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % bound;
      };
      for (let round = 0; round < 200; round++) {
        let maxLength = 3 + next(12);
        const list = new CircularList<number>(maxLength);
        let model: number[] = [];
        let counter = 0;
        for (let step = 0; step < 120; step++) {
          switch (next(6)) {
            case 0:
            case 1:
            case 2:
              list.push(++counter);
              model.push(counter);
              if (model.length > maxLength) {
                model.shift();
              }
              break;
            case 3:
              if (model.length > 0) {
                assert.equal(list.pop(), model.pop());
              }
              break;
            case 4: {
              const count = next(4);
              list.trimStart(count);
              model = model.slice(Math.min(count, model.length));
              break;
            }
            case 5: {
              // Never below the current length: Buffer trims before it shrinks.
              maxLength = Math.max(1, model.length) + next(8);
              list.maxLength = maxLength;
              break;
            }
          }
          assert.equal(list.maxLength, maxLength);
          assert.equal(list.length, model.length);
          for (let i = 0; i < model.length; i++) {
            assert.equal(list.get(i), model[i], `round ${round} step ${step} index ${i}`);
          }
        }
      }
    });

    it('should return the maximum length of the list', () => {
      const list = new CircularList<string>(2);
      assert.equal(list.maxLength, 2);
      list.push('1');
      list.push('2');
      assert.equal(list.maxLength, 2);
      list.push('3');
      assert.equal(list.maxLength, 2);
      list.maxLength = 4;
      assert.equal(list.maxLength, 4);
    });
  });

  describe('length', () => {
    it('should return the current length of the list, capped at the maximum length', () => {
      const list = new CircularList<string>(2);
      assert.equal(list.length, 0);
      list.push('1');
      assert.equal(list.length, 1);
      list.push('2');
      assert.equal(list.length, 2);
      list.push('3');
      assert.equal(list.length, 2);
    });
  });

  describe('splice', () => {
    it('should delete items', () => {
      const list = new CircularList<string>(2);
      list.push('1');
      list.push('2');
      list.splice(0, 1);
      assert.equal(list.length, 1);
      assert.equal(list.get(0), '2');
      list.push('3');
      list.splice(1, 1);
      assert.equal(list.length, 1);
      assert.equal(list.get(0), '2');
    });

    it('should insert items', () => {
      const list = new CircularList<string>(2);
      list.push('1');
      list.splice(0, 0, '2');
      assert.equal(list.length, 2);
      assert.equal(list.get(0), '2');
      assert.equal(list.get(1), '1');
      list.splice(1, 0, '3');
      assert.equal(list.length, 2);
      assert.equal(list.get(0), '3');
      assert.equal(list.get(1), '1');
    });

    it('should delete items then insert items', () => {
      const list = new CircularList<string>(3);
      list.push('1');
      list.push('2');
      list.splice(0, 1, '3', '4');
      assert.equal(list.length, 3);
      assert.equal(list.get(0), '3');
      assert.equal(list.get(1), '4');
      assert.equal(list.get(2), '2');
    });

    it('should wrap the array correctly when more items are inserted than deleted', () => {
      const list = new CircularList<string>(3);
      list.push('1');
      list.push('2');
      list.splice(1, 0, '3', '4');
      assert.equal(list.length, 3);
      assert.equal(list.get(0), '3');
      assert.equal(list.get(1), '4');
      assert.equal(list.get(2), '2');
    });
  });

  describe('trimStart', () => {
    it('should remove items from the beginning of the list', () => {
      const list = new CircularList<string>(5);
      list.push('1');
      list.push('2');
      list.push('3');
      list.push('4');
      list.push('5');
      list.trimStart(1);
      assert.equal(list.length, 4);
      assert.deepEqual(list.get(0), '2');
      assert.deepEqual(list.get(1), '3');
      assert.deepEqual(list.get(2), '4');
      assert.deepEqual(list.get(3), '5');
      list.trimStart(2);
      assert.equal(list.length, 2);
      assert.deepEqual(list.get(0), '4');
      assert.deepEqual(list.get(1), '5');
    });

    it('should remove all items if the requested trim amount is larger than the list\'s length', () => {
      const list = new CircularList<string>(5);
      list.push('1');
      list.trimStart(2);
      assert.equal(list.length, 0);
    });
  });

  describe('shiftElements', () => {
    it('should not mutate the list when count is 0', () => {
      const list = new CircularList<number>(5);
      list.push(1);
      list.push(2);
      list.shiftElements(0, 0, 1);
      assert.equal(list.length, 2);
      assert.equal(list.get(0), 1);
      assert.equal(list.get(1), 2);
    });

    it('should throw for invalid args', () => {
      const list = new CircularList<number>(5);
      list.push(1);
      assert.throws(() => list.shiftElements(-1, 1, 1), 'start argument out of range');
      assert.throws(() => list.shiftElements(1, 1, 1), 'start argument out of range');
      assert.throws(() => list.shiftElements(0, 1, -1), 'Cannot shift elements in list beyond index 0');
    });

    it('should shift an element forward', () => {
      const list = new CircularList<number>(5);
      list.push(1);
      list.push(2);
      list.shiftElements(0, 1, 1);
      assert.equal(list.length, 2);
      assert.equal(list.get(0), 1);
      assert.equal(list.get(1), 1);
    });

    it('should shift elements forward', () => {
      const list = new CircularList<number>(5);
      list.push(1);
      list.push(2);
      list.push(3);
      list.push(4);
      list.shiftElements(0, 2, 2);
      assert.equal(list.length, 4);
      assert.equal(list.get(0), 1);
      assert.equal(list.get(1), 2);
      assert.equal(list.get(2), 1);
      assert.equal(list.get(3), 2);
    });

    it('should shift elements forward, expanding the list if needed', () => {
      const list = new CircularList<number>(5);
      list.push(1);
      list.push(2);
      list.shiftElements(0, 2, 2);
      assert.equal(list.length, 4);
      assert.equal(list.get(0), 1);
      assert.equal(list.get(1), 2);
      assert.equal(list.get(2), 1);
      assert.equal(list.get(3), 2);
    });

    it('should shift elements forward, wrapping the list if needed', () => {
      const list = new CircularList<number>(5);
      list.push(1);
      list.push(2);
      list.push(3);
      list.push(4);
      list.push(5);
      list.shiftElements(2, 2, 3);
      assert.equal(list.length, 5);
      assert.equal(list.get(0), 3);
      assert.equal(list.get(1), 4);
      assert.equal(list.get(2), 5);
      assert.equal(list.get(3), 3);
      assert.equal(list.get(4), 4);
    });

    it('should shift an element backwards', () => {
      const list = new CircularList<number>(5);
      list.push(1);
      list.push(2);
      list.shiftElements(1, 1, -1);
      assert.equal(list.length, 2);
      assert.equal(list.get(0), 2);
      assert.equal(list.get(1), 2);
    });

    it('should shift elements backwards', () => {
      const list = new CircularList<number>(5);
      list.push(1);
      list.push(2);
      list.push(3);
      list.push(4);
      list.shiftElements(2, 2, -2);
      assert.equal(list.length, 4);
      assert.equal(list.get(0), 3);
      assert.equal(list.get(1), 4);
      assert.equal(list.get(2), 3);
      assert.equal(list.get(3), 4);
    });
  });
});
