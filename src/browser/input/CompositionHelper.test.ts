/**
 * Copyright (c) 2016 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { assert } from 'chai';
import { CompositionHelper } from './CompositionHelper';
import { MockRenderService } from '../TestUtils.test';
import { MockCoreService, MockBufferService, MockOptionsService } from '../../common/TestUtils.test';

describe('CompositionHelper', () => {
  let compositionHelper: CompositionHelper;
  let compositionView: HTMLElement;
  let textarea: HTMLTextAreaElement;
  let handledText: string;
  let compositionViewWidth: number;
  let bufferService: MockBufferService;
  let renderService: MockRenderService;

  beforeEach(() => {
    compositionView = {
      classList: {
        add: () => {},
        remove: () => {}
      },
      getBoundingClientRect: () => {
        const maxWidth = Number.parseFloat(compositionView.style.maxWidth) || Number.POSITIVE_INFINITY;
        return { width: Math.min(compositionViewWidth, maxWidth), height: 20 };
      },
      style: {
        left: 0,
        top: 0
      },
      textContent: ''
    } as any;
    compositionViewWidth = 0;
    textarea = {
      value: '',
      style: {
        left: 0,
        top: 0
      }
    } as any;
    const coreService = new MockCoreService();
    coreService.triggerDataEvent = (text: string) => {
      handledText += text;
    };
    handledText = '';
    bufferService = new MockBufferService(10, 5);
    renderService = new MockRenderService();
    renderService.dimensions.css.cell.width = 10;
    renderService.dimensions.css.cell.height = 20;
    compositionHelper = new CompositionHelper(textarea, compositionView, bufferService, new MockOptionsService(), coreService, renderService);
  });

  describe('Layout', () => {
    it('Should shift a preedit left instead of clipping it at the right edge', () => {
      bufferService.buffer.x = 9;
      bufferService.buffer.y = 2;
      compositionViewWidth = 70;

      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'dangzhe' });

      assert.equal(compositionView.style.left, '30px');
      assert.equal(compositionView.style.top, '40px');
      assert.equal(compositionView.style.maxWidth, '100px');
      assert.equal(textarea.style.left, '30px');
      assert.equal(textarea.style.top, '40px');
      assert.equal(textarea.style.width, '70px');
    });

    it('Should keep the composition anchor stable while terminal output moves the cursor', () => {
      bufferService.buffer.x = 9;
      bufferService.buffer.y = 2;
      compositionViewWidth = 70;
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'dangzhe' });

      bufferService.buffer.x = 1;
      bufferService.buffer.y = 4;
      compositionHelper.updateCompositionElements(true);

      assert.equal(compositionView.style.left, '30px');
      assert.equal(compositionView.style.top, '40px');
      assert.equal(textarea.style.left, '30px');
      assert.equal(textarea.style.top, '40px');
    });

    it('Should retain the tail only when a preedit is wider than the terminal', () => {
      bufferService.buffer.x = 9;
      compositionViewWidth = 140;

      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'an-unusually-long-composition' });

      assert.equal(compositionView.style.left, '0px');
      assert.equal(compositionView.style.maxWidth, '100px');
      assert.equal(compositionView.style.direction, 'rtl');
      assert.equal(textarea.style.left, '0px');
      assert.equal(textarea.style.width, '100px');
    });
  });

  describe('Input', () => {
    it('Should emit a composition only once when Tab finalizes it before compositionend', (done) => {
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'hh' });
      textarea.value = 'hh';
      setTimeout(() => {
        assert.isTrue(compositionHelper.keydown({ keyCode: 9 } as KeyboardEvent));
        assert.equal(handledText, 'hh');
        // macOS still delivers the native compositionend after the Tab
        // keydown forced the synchronous commit.
        compositionHelper.compositionend();
        setTimeout(() => {
          assert.equal(handledText, 'hh');
          done();
        }, 0);
      }, 0);
    });

    it('Should prefer committed input over a pending keydown-229 textarea diff', (done) => {
      assert.isFalse(compositionHelper.keydown({ keyCode: 229 } as KeyboardEvent));
      textarea.value = '，';
      assert.isTrue(compositionHelper.handleInputEvent({
        data: '，',
        inputType: 'insertText'
      }, false));
      setTimeout(() => {
        assert.equal(handledText, '，');
        assert.equal(textarea.value, '');
        done();
      }, 0);
    });

    it('Should treat insertFromComposition as authoritative without compositionend', (done) => {
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: '你' });
      textarea.value = '你';
      assert.isTrue(compositionHelper.handleInputEvent({
        data: '你',
        inputType: 'insertFromComposition'
      }, false));
      setTimeout(() => {
        assert.equal(handledText, '你');
        assert.isFalse(compositionHelper.isComposing);
        assert.equal(textarea.value, '');
        done();
      }, 0);
    });

    it('Should insert simple characters', (done) => {
      // First character 'ㅇ'
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'ㅇ' });
      textarea.value = 'ㅇ';
      setTimeout(() => { // wait for any textarea updates
        compositionHelper.compositionend();
        setTimeout(() => { // wait for any textarea updates
          assert.equal(handledText, 'ㅇ');
          // Second character 'ㅇ'
          compositionHelper.compositionstart();
          compositionHelper.compositionupdate({ data: 'ㅇ' });
          textarea.value = 'ㅇㅇ';
          setTimeout(() => { // wait for any textarea updates
            compositionHelper.compositionend();
            setTimeout(() => { // wait for any textarea updates
              assert.equal(handledText, 'ㅇㅇ');
              done();
            }, 0);
          }, 0);
        }, 0);
      }, 0);
    });

    it('Should insert complex characters', (done) => {
      // First character '앙'
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'ㅇ' });
      textarea.value = 'ㅇ';
      setTimeout(() => { // wait for any textarea updates
        compositionHelper.compositionupdate({ data: '아' });
        textarea.value = '아';
        setTimeout(() => { // wait for any textarea updates
          compositionHelper.compositionupdate({ data: '앙' });
          textarea.value = '앙';
          setTimeout(() => { // wait for any textarea updates
            compositionHelper.compositionend();
            setTimeout(() => { // wait for any textarea updates
              assert.equal(handledText, '앙');
              // Second character '앙'
              compositionHelper.compositionstart();
              compositionHelper.compositionupdate({ data: 'ㅇ' });
              textarea.value = '앙ㅇ';
              setTimeout(() => { // wait for any textarea updates
                compositionHelper.compositionupdate({ data: '아' });
                textarea.value = '앙아';
                setTimeout(() => { // wait for any textarea updates
                  compositionHelper.compositionupdate({ data: '앙' });
                  textarea.value = '앙앙';
                  setTimeout(() => { // wait for any textarea updates
                    compositionHelper.compositionend();
                    setTimeout(() => { // wait for any textarea updates
                      assert.equal(handledText, '앙앙');
                      done();
                    }, 0);
                  }, 0);
                }, 0);
              }, 0);
            }, 0);
          }, 0);
        }, 0);
      }, 0);
    });

    it('Should insert complex characters that change with following character', (done) => {
      // First character '아'
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'ㅇ' });
      textarea.value = 'ㅇ';
      setTimeout(() => { // wait for any textarea updates
        compositionHelper.compositionupdate({ data: '아' });
        textarea.value = '아';
        setTimeout(() => { // wait for any textarea updates
          // Start second character '아' in first character
          compositionHelper.compositionupdate({ data: '앙' });
          textarea.value = '앙';
          setTimeout(() => { // wait for any textarea updates
            compositionHelper.compositionend();
            compositionHelper.compositionstart();
            compositionHelper.compositionupdate({ data: '아' });
            textarea.value = '아아';
            setTimeout(() => { // wait for any textarea updates
              compositionHelper.compositionend();
              setTimeout(() => { // wait for any textarea updates
                assert.equal(handledText, '아아');
                done();
              }, 0);
            }, 0);
          }, 0);
        }, 0);
      }, 0);
    });

    it('Should insert multi-characters compositions', (done) => {
      // First character 'だ'
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'd' });
      textarea.value = 'd';
      setTimeout(() => { // wait for any textarea updates
        compositionHelper.compositionupdate({ data: 'だ' });
        textarea.value = 'だ';
        setTimeout(() => { // wait for any textarea updates
          // Second character 'あ'
          compositionHelper.compositionupdate({ data: 'だあ' });
          textarea.value = 'だあ';
          setTimeout(() => { // wait for any textarea updates
            compositionHelper.compositionend();
            setTimeout(() => { // wait for any textarea updates
              assert.equal(handledText, 'だあ');
              done();
            }, 0);
          }, 0);
        }, 0);
      }, 0);
    });

    it('Should insert multi-character compositions that are converted to other characters with the same length', (done) => {
      // First character 'だ'
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'd' });
      textarea.value = 'd';
      setTimeout(() => { // wait for any textarea updates
        compositionHelper.compositionupdate({ data: 'だ' });
        textarea.value = 'だ';
        setTimeout(() => { // wait for any textarea updates
          // Second character 'ー'
          compositionHelper.compositionupdate({ data: 'だー' });
          textarea.value = 'だー';
          setTimeout(() => { // wait for any textarea updates
            // Convert to katakana 'ダー'
            compositionHelper.compositionupdate({ data: 'ダー' });
            textarea.value = 'ダー';
            setTimeout(() => { // wait for any textarea updates
              compositionHelper.compositionend();
              setTimeout(() => { // wait for any textarea updates
                assert.equal(handledText, 'ダー');
                done();
              }, 0);
            }, 0);
          }, 0);
        }, 0);
      }, 0);
    });

    it('Should insert multi-character compositions that are converted to other characters with different lengths', (done) => {
      // First character 'い'
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'い' });
      textarea.value = 'い';
      setTimeout(() => { // wait for any textarea updates
        // Second character 'ま'
        compositionHelper.compositionupdate({ data: 'いm' });
        textarea.value = 'いm';
        setTimeout(() => { // wait for any textarea updates
          compositionHelper.compositionupdate({ data: 'いま' });
          textarea.value = 'いま';
          setTimeout(() => { // wait for any textarea updates
            // Convert to kanji '今'
            compositionHelper.compositionupdate({ data: '今' });
            textarea.value = '今';
            setTimeout(() => { // wait for any textarea updates
              compositionHelper.compositionend();
              setTimeout(() => { // wait for any textarea updates
                assert.equal(handledText, '今');
                done();
              }, 0);
            }, 0);
          }, 0);
        }, 0);
      }, 0);
    });

    it('Should insert non-composition characters input immediately after composition characters', (done) => {
      // First character 'ㅇ'
      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: 'ㅇ' });
      textarea.value = 'ㅇ';
      setTimeout(() => { // wait for any textarea updates
        compositionHelper.compositionend();
        // Second character '1' (a non-composition character)
        textarea.value = 'ㅇ1';
        setTimeout(() => { // wait for any textarea updates
          assert.equal(handledText, 'ㅇ1');
          done();
        }, 0);
      }, 0);
    });

    it('Should insert middle composition and subsequent input without appending existing trailing text', (done) => {
      textarea.value = '一二';
      // screenReaderMode keeps textarea content/selection for assistive technologies (eg. screen
      // readers), so the caret can be moved within the textarea (eg. via arrow keys) before
      // starting composition.
      textarea.selectionStart = 1;
      textarea.selectionEnd = 1;

      compositionHelper.compositionstart();
      compositionHelper.compositionupdate({ data: '一' });
      textarea.value = '一一二';
      // After the composed text is inserted, the caret typically moves to after it.
      textarea.selectionStart = 2;
      textarea.selectionEnd = 2;

      setTimeout(() => { // wait for any textarea updates
        compositionHelper.compositionend();
        // Second character '1' (a non-composition character)
        textarea.value = '一一1二';
        setTimeout(() => { // wait for any textarea updates
          assert.equal(handledText, '一1');
          done();
        }, 0);
      }, 0);
    });
  });
});
