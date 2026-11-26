/**
 * Copyright (c) 2019 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { assert } from 'chai';
import { WriteBuffer } from './WriteBuffer';

// eslint-disable-next-line @typescript-eslint/naming-convention
declare let Buffer: any;

function toBytes(s: string): Uint8Array {
  return Buffer.from(s);
}

function fromBytes(bytes: Uint8Array): string {
  return bytes.toString();
}

describe('WriteBuffer', () => {
  let wb: WriteBuffer;
  let stack: (string | Uint8Array)[] = [];
  let cbStack: string[] = [];
  beforeEach(() => {
    stack = [];
    cbStack = [];
    wb = new WriteBuffer(data => { stack.push(data); });
  });
  describe('write input', () => {
    it('string', done => {
      wb.write('a._');
      wb.write('b.x', () => { cbStack.push('b'); });
      wb.write('c._');
      wb.write('d.x', () => { cbStack.push('d'); });
      wb.write('e', () => {
        assert.deepEqual(stack, ['a._', 'b.x', 'c._', 'd.x', 'e']);
        assert.deepEqual(cbStack, ['b', 'd']);
        done();
      });
    });
    it('bytes', done => {
      wb.write(toBytes('a._'));
      wb.write(toBytes('b.x'), () => { cbStack.push('b'); });
      wb.write(toBytes('c._'));
      wb.write(toBytes('d.x'), () => { cbStack.push('d'); });
      wb.write(toBytes('e'), () => {
        assert.deepEqual(stack.map(val => typeof val === 'string' ? '' :  fromBytes(val)), ['a._', 'b.x', 'c._', 'd.x', 'e']);
        assert.deepEqual(cbStack, ['b', 'd']);
        done();
      });
    });
    it('string/bytes mixed', done => {
      wb.write('a._');
      wb.write('b.x', () => { cbStack.push('b'); });
      wb.write(toBytes('c._'));
      wb.write(toBytes('d.x'), () => { cbStack.push('d'); });
      wb.write(toBytes('e'), () => {
        assert.deepEqual(stack.map(val => typeof val === 'string' ? val :  fromBytes(val)), ['a._', 'b.x', 'c._', 'd.x', 'e']);
        assert.deepEqual(cbStack, ['b', 'd']);
        done();
      });
    });
    it('write callback works for empty chunks', done => {
      wb.write('a', () => { cbStack.push('a'); });
      wb.write('', () => { cbStack.push('b'); });
      wb.write(toBytes('c'), () => { cbStack.push('c'); });
      wb.write(new Uint8Array(0), () => { cbStack.push('d'); });
      wb.write('e', () => {
        assert.deepEqual(stack.map(val => typeof val === 'string' ? val :  fromBytes(val)), ['a', '', 'c', '', 'e']);
        assert.deepEqual(cbStack, ['a', 'b', 'c', 'd']);
        done();
      });
    });
    it('writeSync', done => {
      wb.write('a', () => { cbStack.push('a'); });
      wb.write('b', () => { cbStack.push('b'); });
      wb.write('c', () => { cbStack.push('c'); });
      wb.writeSync('d');
      assert.deepEqual(stack, ['a', 'b', 'c', 'd']);
      assert.deepEqual(cbStack, ['a', 'b', 'c']);
      wb.write('x', () => { cbStack.push('x'); });
      wb.write('', () => {
        assert.deepEqual(stack, ['a', 'b', 'c', 'd', 'x', '']);
        assert.deepEqual(cbStack, ['a', 'b', 'c', 'x']);
        done();
      });
    });
    it('writeSync called from action does not overflow callstack - issue #3265', () => {
      wb = new WriteBuffer(data => {
        const num = parseInt(data as string);
        if (num < 10000) {
          wb.writeSync('' + (num + 1));
        }
      });
      wb.writeSync('1');
    });
    it('writeSync maxSubsequentCalls argument', () => {
      let last: string = '';
      wb = new WriteBuffer(data => {
        last = data as string;
        const num = parseInt(data as string);
        if (num < 1000000) {
          wb.writeSync('' + (num + 1), 10);
        }
      });
      wb.writeSync('1', 10);
      assert.equal(last, '11'); // 1 + 10 sub calls = 11
    });
    it('flushSync processes all pending writes', done => {
      wb.write('a', () => { cbStack.push('a'); });
      wb.write('b', () => { cbStack.push('b'); });
      wb.write('c', () => { cbStack.push('c'); });
      wb.flushSync();
      assert.deepEqual(stack, ['a', 'b', 'c']);
      assert.deepEqual(cbStack, ['a', 'b', 'c']);
      wb.write('x', () => { cbStack.push('x'); });
      wb.write('', () => {
        assert.deepEqual(stack, ['a', 'b', 'c', 'x', '']);
        assert.deepEqual(cbStack, ['a', 'b', 'c', 'x']);
        done();
      });
    });
    it('flushSync does not parse chunks the write loop already parsed', done => {
      // More chunks than one 12 ms slice can take: the first slice ends with
      // parsed chunks still retained in front of the read offset.
      const slow = new WriteBuffer(data => {
        stack.push(data);
        const until = Date.now() + 5;
        while (Date.now() < until) { /* burn the time slice */ }
      });
      const total = 8;
      for (let i = 0; i < total; i++) {
        slow.write(`chunk-${i}`, () => { cbStack.push(`cb-${i}`); });
      }
      const expected = Array.from({ length: total }, (_, i) => `chunk-${i}`);
      const waitForFirstSlice = (): void => {
        if (stack.length === 0) {
          setTimeout(waitForFirstSlice, 0);
          return;
        }
        assert.isBelow(stack.length, total, 'the first slice must not finish the queue');
        slow.flushSync();
        assert.deepEqual(stack, expected);
        assert.deepEqual(cbStack, expected.map((_, i) => `cb-${i}`));
        // The continuation the first slice scheduled finds nothing to repeat.
        setTimeout(() => {
          assert.deepEqual(stack, expected);
          assert.deepEqual(cbStack, expected.map((_, i) => `cb-${i}`));
          done();
        }, 30);
      };
      waitForFirstSlice();
    });
    it('flushSync inside a write callback parses every chunk exactly once', done => {
      wb.write('a', () => {
        cbStack.push('a');
        wb.flushSync();
        assert.deepEqual(stack, ['a', 'b', 'c']);
        assert.deepEqual(cbStack, ['a', 'b', 'c']);
      });
      wb.write('b', () => { cbStack.push('b'); });
      wb.write('c', () => { cbStack.push('c'); });
      setTimeout(() => {
        assert.deepEqual(stack, ['a', 'b', 'c']);
        assert.deepEqual(cbStack, ['a', 'b', 'c']);
        done();
      }, 30);
    });
    it('a write issued after flushSync inside a write callback is not lost', done => {
      wb.write('a', () => {
        wb.flushSync();
        wb.write('late', () => { cbStack.push('late'); });
      });
      wb.write('b');
      setTimeout(() => {
        assert.deepEqual(stack, ['a', 'b', 'late']);
        assert.deepEqual(cbStack, ['late']);
        wb.write('after', () => {
          assert.deepEqual(stack, ['a', 'b', 'late', 'after']);
          done();
        });
      }, 30);
    });
    it('flushSync parses a queued empty chunk and what follows it', () => {
      wb.write('', () => { cbStack.push('empty'); });
      wb.write('x', () => { cbStack.push('x'); });
      wb.flushSync();
      assert.deepEqual(stack, ['', 'x']);
      assert.deepEqual(cbStack, ['empty', 'x']);
    });
    it('flushSync refuses to run while an asynchronous handler is pending', async () => {
      let release!: (value: boolean) => void;
      const seen: (string | Uint8Array)[] = [];
      let suspended = false;
      const parked = new WriteBuffer(data => {
        if (data === 'async') {
          if (suspended) {
            // The continuation of the suspended chunk, not a second parse.
            return;
          }
          suspended = true;
          seen.push(data);
          return new Promise<boolean>(resolve => { release = resolve; });
        }
        seen.push(data);
      });
      parked.write('async');
      parked.write('next');
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      assert.deepEqual(seen, ['async']);
      assert.throws(() => parked.flushSync(), /being parsed/);
      // Nothing was released or repeated by the refused flush.
      release(true);
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      assert.deepEqual(seen, ['async', 'next']);
    });
    it('flushSync refuses to run from inside a parser handler', () => {
      const reentrant: WriteBuffer = new WriteBuffer(data => {
        stack.push(data);
        if (data === 'resize-me') {
          assert.throws(() => reentrant.flushSync(), /being parsed/);
        }
      });
      reentrant.handleUserInput();
      reentrant.write('resize-me');
      assert.deepEqual(stack, ['resize-me']);
    });
    it('flushSync with no pending writes is a no-op', () => {
      wb.flushSync();
      assert.deepEqual(stack, []);
      assert.deepEqual(cbStack, []);
    });
    it('flushSync fires onWriteParsed', () => {
      let parsed = 0;
      wb.onWriteParsed(() => parsed++);
      wb.write('a');
      wb.write('b');
      assert.equal(parsed, 0);
      wb.flushSync();
      assert.equal(parsed, 1);
    });
    it('flushSync with no pending writes does not fire onWriteParsed', () => {
      let parsed = 0;
      wb.onWriteParsed(() => parsed++);
      wb.flushSync();
      assert.equal(parsed, 0);
    });
    it('pause retains queued and subsequent writes until resume', async () => {
      wb.write('a', () => { cbStack.push('a'); });
      await wb.pause();
      wb.write('b', () => { cbStack.push('b'); });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.deepEqual(stack, []);
      assert.deepEqual(cbStack, []);

      await new Promise<void>(resolve => {
        wb.write('c', () => {
          cbStack.push('c');
          resolve();
        });
        wb.resume();
      });
      assert.deepEqual(stack, ['a', 'b', 'c']);
      assert.deepEqual(cbStack, ['a', 'b', 'c']);
    });
    it('pause resolves only after an asynchronous parser chunk completes', async () => {
      let resolveParser!: (value: boolean) => void;
      let first = true;
      wb = new WriteBuffer(data => {
        stack.push(data);
        if (first) {
          first = false;
          return new Promise<boolean>(resolve => {
            resolveParser = resolve;
          });
        }
      });
      wb.write('a', () => { cbStack.push('a'); });
      wb.write('b', () => { cbStack.push('b'); });
      await new Promise(resolve => setTimeout(resolve, 0));

      let paused = false;
      const frontier = wb.pause().then(() => {
        paused = true;
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(paused, false);
      resolveParser(false);
      await frontier;
      assert.deepEqual(stack, ['a', 'a']);
      assert.deepEqual(cbStack, ['a']);

      await new Promise<void>(resolve => {
        wb.write('c', resolve);
        wb.resume();
      });
      assert.deepEqual(stack, ['a', 'a', 'b', 'c']);
      assert.deepEqual(cbStack, ['a', 'b']);
    });
    it('pause preserves a scheduled asynchronous parser continuation', async () => {
      let resolveParser!: (value: boolean) => void;
      let first = true;
      wb = new WriteBuffer(data => {
        stack.push(data);
        if (first) {
          first = false;
          return new Promise<boolean>(resolve => {
            resolveParser = resolve;
          });
        }
      });
      wb.write('a', () => { cbStack.push('a'); });
      wb.write('b', () => { cbStack.push('b'); });
      await new Promise(resolve => setTimeout(resolve, 20));

      // Resolving after the write slice budget schedules the continuation on
      // a timer. Pause in the intervening microtask: it must not cancel that
      // active-chunk continuation or its frontier would never be reached.
      resolveParser(false);
      await Promise.resolve();
      const frontier = wb.pause();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        frontier.then(() => 'paused'),
        new Promise<string>(resolve => {
          timeout = setTimeout(() => resolve('timed out'), 1000);
        }),
      ]);
      clearTimeout(timeout);
      assert.equal(result, 'paused');
      assert.deepEqual(stack, ['a', 'a']);
      assert.deepEqual(cbStack, ['a']);

      await new Promise<void>(resolve => {
        wb.write('c', resolve);
        wb.resume();
      });
      assert.deepEqual(stack, ['a', 'a', 'b', 'c']);
      assert.deepEqual(cbStack, ['a', 'b']);
    });
    it('dispose cancels scheduled innerWrite', done => {
      wb.write('a');
      wb.dispose();
      setTimeout(() => {
        assert.deepEqual(stack, []);
        done();
      }, 20);
    });
    it('dispose does not fire onWriteParsed for pending writes', done => {
      let parsed = 0;
      wb.onWriteParsed(() => parsed++);
      wb.write('a');
      wb.dispose();
      setTimeout(() => {
        assert.equal(parsed, 0);
        done();
      }, 20);
    });
    it('write after dispose is a no-op', done => {
      wb.dispose();
      wb.write('a');
      setTimeout(() => {
        assert.deepEqual(stack, []);
        done();
      }, 20);
    });
    it('dispose is idempotent', done => {
      wb.write('a');
      wb.dispose();
      wb.dispose();
      setTimeout(() => {
        assert.deepEqual(stack, []);
        done();
      }, 20);
    });
    it('async handler continuation is skipped after dispose', done => {
      let resolve!: (value: boolean) => void;
      const pending = new Promise<boolean>(r => { resolve = r; });
      wb = new WriteBuffer(() => pending);
      wb.write('a');
      wb.dispose();
      resolve(true);
      setTimeout(() => {
        assert.deepEqual(stack, []);
        done();
      }, 20);
    });
    it('handleUserInput still processes first chunk synchronously', () => {
      wb.handleUserInput();
      wb.write('a');
      assert.deepEqual(stack, ['a']);
    });
    it('flushSync after dispose is a no-op', done => {
      wb.write('a');
      wb.dispose();
      wb.flushSync();
      setTimeout(() => {
        assert.deepEqual(stack, []);
        done();
      }, 20);
    });
    it('writeSync after dispose is a no-op', () => {
      wb.dispose();
      wb.writeSync('a');
      assert.deepEqual(stack, []);
    });
  });
});
