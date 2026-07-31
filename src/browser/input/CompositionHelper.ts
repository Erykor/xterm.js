/**
 * Copyright (c) 2016 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { IRenderService } from '../services/Services';
import { IBufferService, ICoreService, IOptionsService } from '../../common/services/Services';
import { C0 } from '../../common/data/EscapeSequences';

interface IPosition {
  start: number;
  end: number;
}

/**
 * Encapsulates the logic for handling compositionstart, compositionupdate and compositionend
 * events, displaying the in-progress composition to the UI and forwarding the final composition
 * to the handler.
 */
export class CompositionHelper {
  /**
   * Whether input composition is currently happening, eg. via a mobile keyboard, speech input or
   * IME. This variable determines whether the compositionText should be displayed on the UI.
   */
  private _isComposing: boolean;
  public get isComposing(): boolean { return this._isComposing; }

  /**
   * The position within the input textarea's value of the current composition.
   */
  private _compositionPosition: IPosition;

  /**
   * Text that existed after the composing range when composition started.
   * This is used to avoid treating existing trailing text as new input.
   */
  private _compositionSuffix: string;

  /**
   * Whether a composition is in the process of being sent, setting this to false will cancel any
   * in-progress composition.
   */
  private _isSendingComposition: boolean;

  /**
   * Data already sent due to keydown event.
   */
  private _dataAlreadySent: string;

  /**
   * The pending textarea change timer, if any.
   */
  private _textareaChangeTimer?: ReturnType<typeof setTimeout>;

  /**
   * The pending idle textarea cleanup timer, if any. Textarea reads and cleanup are owned by this
   * class so a host cannot clear a value while a composition or keydown-229 diff still needs it.
   */
  private _textareaCleanupTimer?: ReturnType<typeof setTimeout>;

  /**
   * Composition text that was synchronously emitted because another key (for example Tab or Enter)
   * ended the composition before the native compositionend/input events arrived.
   */
  private _pendingCompositionInputEcho: string;

  constructor(
    private readonly _textarea: HTMLTextAreaElement,
    private readonly _compositionView: HTMLElement,
    @IBufferService private readonly _bufferService: IBufferService,
    @IOptionsService private readonly _optionsService: IOptionsService,
    @ICoreService private readonly _coreService: ICoreService,
    @IRenderService private readonly _renderService: IRenderService
  ) {
    this._isComposing = false;
    this._isSendingComposition = false;
    this._compositionPosition = { start: 0, end: 0 };
    this._compositionSuffix = '';
    this._dataAlreadySent = '';
    this._pendingCompositionInputEcho = '';
  }

  /**
   * Handles the compositionstart event, activating the composition view.
   */
  public compositionstart(): void {
    this._cancelTextareaCleanup();
    this._isComposing = true;
    this._pendingCompositionInputEcho = '';
    // It's important to use the selection here instead of textarea length to avoid conflicts with
    // screen reader mode
    const start = this._textarea.selectionStart ?? this._textarea.value.length;
    const end = this._textarea.selectionEnd ?? start;
    this._compositionPosition.start = Math.min(start, end);
    this._compositionPosition.end = Math.max(start, end);
    this._compositionSuffix = this._textarea.value.substring(this._compositionPosition.end);
    this._compositionView.textContent = '';
    this._dataAlreadySent = '';
    this._compositionView.classList.add('active');
  }

  /**
   * Handles the compositionupdate event, updating the composition view.
   * @param ev The event.
   */
  public compositionupdate(ev: Pick<CompositionEvent, 'data'>): void {
    // Mark text as LTR, direction=rtl is used in CSS so the end of the text is followed for long
    // compositions
    this._compositionView.textContent = `\u200E${ev.data}\u200E`;
    this.updateCompositionElements();
    setTimeout(() => {
      const end = this._textarea.selectionEnd ?? this._textarea.value.length;
      this._compositionPosition.end = Math.max( this._compositionPosition.start, end);
    }, 0);
  }

  /**
   * Handles the compositionend event, hiding the composition view and sending the composition to
   * the handler.
   */
  public compositionend(): void {
    // A non-composition keydown can synchronously finalize the composition so its data reaches the
    // PTY before that key. WebKit still emits the native compositionend afterwards; treating it as
    // a second finalization duplicates the entire preedit (notably ASCII followed by Tab).
    if (!this._isComposing) {
      this._scheduleTextareaCleanup();
      return;
    }
    this._finalizeComposition(true);
  }

  /**
   * Handles a committed native input event. `input` is the only commit signal consistently emitted
   * by the major IME implementations, so it wins over both the compositionend reader and the
   * keydown-229 textarea diff. Those paths remain fallbacks when no input event arrives.
   *
   * @param ev The committed input event.
   * @param wasAlreadySent Whether the same text was emitted by a physical keydown/keypress.
   * @returns Whether the event was a committed text input handled by this helper.
   */
  public handleInputEvent(
    ev: Pick<InputEvent, 'data' | 'inputType'>,
    wasAlreadySent: boolean
  ): boolean {
    if (!ev.data || ev.inputType !== 'insertText' || this._optionsService.rawOptions.screenReaderMode) {
      return false;
    }

    // An authoritative input event supersedes both asynchronous fallback readers. Merely letting
    // them observe the same textarea later would duplicate the input (or turn cleanup into DEL).
    if (this._textareaChangeTimer !== undefined) {
      clearTimeout(this._textareaChangeTimer);
      this._textareaChangeTimer = undefined;
    }
    this._isSendingComposition = false;
    if (this._isComposing) {
      this._isComposing = false;
      this._compositionView.classList.remove('active');
    }

    let input = ev.data;
    if (this._pendingCompositionInputEcho) {
      if (input === this._pendingCompositionInputEcho) {
        input = '';
      } else if (input.startsWith(this._pendingCompositionInputEcho)) {
        // Some engines report the committed composition and the immediately following text in one
        // input event. Only the suffix has not already been sent.
        input = input.substring(this._pendingCompositionInputEcho.length);
      }
      this._pendingCompositionInputEcho = '';
    }
    if (!wasAlreadySent && input.length > 0) {
      this._coreService.triggerDataEvent(input, true);
    }
    this._scheduleTextareaCleanup();
    return true;
  }

  /**
   * Handles the keydown event, routing any necessary events to the CompositionHelper functions.
   * @param ev The keydown event.
   * @returns Whether the Terminal should continue processing the keydown event.
   */
  public keydown(ev: KeyboardEvent): boolean {
    this._cancelTextareaCleanup();
    if (!this._isComposing && !this._isSendingComposition) {
      // This is a strict transaction boundary. Clear settled residue before the new key can ask
      // _handleAnyTextareaChanges to snapshot the textarea.
      this._pendingCompositionInputEcho = '';
      this._clearTextarea();
    }
    if (this._isComposing || this._isSendingComposition) {
      if (ev.keyCode === 20 || ev.keyCode === 229) {
        // 20 is CapsLock, 229 is Enter
        // Continue composing if the keyCode is the "composition character"
        return false;
      }
      if (ev.keyCode === 16 || ev.keyCode === 17 || ev.keyCode === 18) {
        // Continue composing if the keyCode is a modifier key
        return false;
      }
      // Finish composition immediately. This is mainly here for the case where enter is
      // pressed and the handler needs to be triggered before the command is executed.
      this._finalizeComposition(false);
    }

    if (ev.keyCode === 229) {
      // If the "composition character" is used but gets to this point it means a non-composition
      // character (eg. numbers and punctuation) was pressed when the IME was active.
      this._handleAnyTextareaChanges();
      return false;
    }

    return true;
  }

  /**
   * Finalizes the composition, resuming regular input actions. This is called when a composition
   * is ending.
   * @param waitForPropagation Whether to wait for events to propagate before sending
   *   the input. This should be false if a non-composition keystroke is entered before the
   *   compositionend event is triggered, such as enter, so that the composition is sent before
   *   the command is executed.
   */
  private _finalizeComposition(waitForPropagation: boolean): void {
    this._compositionView.classList.remove('active');
    this._isComposing = false;

    if (!waitForPropagation) {
      // Cancel any delayed composition send requests and send the input immediately.
      this._isSendingComposition = false;
      const input = this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end);
      if (input.length > 0) {
        this._pendingCompositionInputEcho = input;
        this._coreService.triggerDataEvent(input, true);
      }
      this._scheduleTextareaCleanup();
    } else {
      // Make a deep copy of the composition position here as a new compositionstart event may
      // fire before the setTimeout executes.
      const currentCompositionPosition = {
        start: this._compositionPosition.start,
        end: this._compositionPosition.end
      };
      const currentCompositionSuffix = this._compositionSuffix;

      // Since composition* events happen before the changes take place in the textarea on most
      // browsers, use a setTimeout with 0ms time to allow the native compositionend event to
      // complete. This ensures the correct character is retrieved.
      // This solution was used because:
      // - The compositionend event's data property is unreliable, at least on Chromium
      // - The last compositionupdate event's data property does not always accurately describe
      //   the character, a counter example being Korean where an ending consonsant can move to
      //   the following character if the following input is a vowel.
      this._isSendingComposition = true;
      setTimeout(() => {
        // Ensure that the input has not already been sent
        if (this._isSendingComposition) {
          this._isSendingComposition = false;
          let input;
          // Add length of data already sent due to keydown event,
          // otherwise input characters can be duplicated. (Issue #3191)
          currentCompositionPosition.start += this._dataAlreadySent.length;
          if (this._isComposing) {
            // Use the start position of the new composition to get the string
            // if a new composition has started.
            input = this._textarea.value.substring(currentCompositionPosition.start, this._compositionPosition.start);
          } else {
            // Keep support for non-composition characters typed immediately after composition end
            // while avoiding re-sending the trailing text that was already present
            // before composition started.
            const value = this._textarea.value;
            const valueEnd = currentCompositionSuffix.length > 0 && value.endsWith(currentCompositionSuffix)
              ? value.length - currentCompositionSuffix.length
              : value.length;
            input = value.substring(currentCompositionPosition.start, Math.max(currentCompositionPosition.start, valueEnd));
          }
          if (input.length > 0) {
            this._pendingCompositionInputEcho = input;
            this._coreService.triggerDataEvent(input, true);
          }
          this._scheduleTextareaCleanup();
        }
      }, 0);
    }
  }

  /**
   * Apply any changes made to the textarea after the current event chain is allowed to complete.
   * This should be called when not currently composing but a keydown event with the "composition
   * character" (229) is triggered, in order to allow non-composition text to be entered when an
   * IME is active.
   */
  private _handleAnyTextareaChanges(): void {
    if (this._textareaChangeTimer !== undefined) {
      return;
    }
    this._cancelTextareaCleanup();
    const oldValue = this._textarea.value;
    this._textareaChangeTimer = setTimeout(() => {
      this._textareaChangeTimer = undefined;
      // Ignore if a composition has started since the timeout
      if (!this._isComposing) {
        const newValue = this._textarea.value;

        const diff = newValue.replace(oldValue, '');

        this._dataAlreadySent = diff;

        if (newValue.length > oldValue.length) {
          this._pendingCompositionInputEcho = diff;
          this._coreService.triggerDataEvent(diff, true);
        } else if (newValue.length < oldValue.length) {
          this._coreService.triggerDataEvent(`${C0.DEL}`, true);
        } else if ((newValue.length === oldValue.length) && (newValue !== oldValue)) {
          this._pendingCompositionInputEcho = newValue;
          this._coreService.triggerDataEvent(newValue, true);
        }

      }
      this._scheduleTextareaCleanup();
    }, 0);
  }

  private _cancelTextareaCleanup(): void {
    if (this._textareaCleanupTimer !== undefined) {
      clearTimeout(this._textareaCleanupTimer);
      this._textareaCleanupTimer = undefined;
    }
  }

  private _scheduleTextareaCleanup(): void {
    if (this._optionsService.rawOptions.screenReaderMode) {
      return;
    }
    this._cancelTextareaCleanup();
    this._textareaCleanupTimer = setTimeout(() => {
      this._textareaCleanupTimer = undefined;
      if (!this._isComposing && !this._isSendingComposition && this._textareaChangeTimer === undefined) {
        this._clearTextarea();
        this._pendingCompositionInputEcho = '';
      }
    }, 0);
  }

  private _clearTextarea(): void {
    if (!this._optionsService.rawOptions.screenReaderMode && this._textarea.value) {
      this._textarea.value = '';
    }
  }

  /**
   * Positions the composition view on top of the cursor and the textarea just below it (so the
   * IME helper dialog is positioned correctly).
   * @param dontRecurse Whether to use setTimeout to recursively trigger another update, this is
   *   necessary as the IME events across browsers are not consistently triggered.
   */
  public updateCompositionElements(dontRecurse?: boolean): void {
    if (!this._isComposing) {
      return;
    }

    if (this._bufferService.buffer.isCursorInViewport) {
      const cursorX = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1);

      const cellHeight = this._renderService.dimensions.css.cell.height;
      const cursorTop = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height;
      const cursorLeft = cursorX * this._renderService.dimensions.css.cell.width;

      this._compositionView.style.left = cursorLeft + 'px';
      this._compositionView.style.top = cursorTop + 'px';
      this._compositionView.style.height = cellHeight + 'px';
      this._compositionView.style.lineHeight = cellHeight + 'px';
      this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily;
      this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + 'px';
      // Limit the composition view width to the space between the cursor and
      // the terminal's right edge, preventing it from overflowing the terminal.
      const maxWidth = this._bufferService.cols * this._renderService.dimensions.css.cell.width - cursorLeft;
      this._compositionView.style.maxWidth = maxWidth + 'px';
      this._compositionView.style.overflow = 'hidden';
      this._compositionView.style.direction = 'rtl';
      // Sync the textarea to the exact position of the composition view so the IME knows where the
      // text is.
      const compositionViewBounds = this._compositionView.getBoundingClientRect();
      this._textarea.style.left = cursorLeft + 'px';
      this._textarea.style.top = cursorTop + 'px';
      // Ensure the text area is at least 1x1, otherwise certain IMEs may break
      this._textarea.style.width = Math.max(compositionViewBounds.width, 1) + 'px';
      this._textarea.style.height = Math.max(compositionViewBounds.height, 1) + 'px';
      this._textarea.style.lineHeight = compositionViewBounds.height + 'px';
    }

    if (!dontRecurse) {
      setTimeout(() => this.updateCompositionElements(true), 0);
    }
  }
}
