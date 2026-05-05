// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";

import { IconChevronDown } from "../Icons";

/**
 * Option in the dropdown half of a {@link SplitButton}. `destructive`
 * adds the danger accent (red text); the consumer is expected to
 * surface a confirmation dialog before invoking `onSelect`.
 */
export interface SplitButtonOption {
  id: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  /** Tooltip on the row — surfaces deferred reasons like "needs #11". */
  tooltip?: string;
}

interface SplitButtonProps {
  /** Icon rendered next to the main label. */
  icon: JSX.Element;
  /** Main button label (typically the active default option's label). */
  label: string;
  /** Items shown when the chevron opens the dropdown. */
  options: SplitButtonOption[];
  /** Id of the option marked with the radio "default" dot. */
  defaultOptionId?: string;
  /** Subtitle inside the dropdown (e.g. "Choose your pull strategy…"). */
  header?: string;
  /** Disable just the main click (chevron stays clickable). */
  buttonDisabled?: boolean;
  /** Disable just the chevron (main stays clickable). */
  dropdownDisabled?: boolean;
  /** Click handler for the main half. Omit → main click = open dropdown. */
  onMainClick?: () => void;
  /** Click handler for an option row (also invoked by `onMainClick` paths
   *  that delegate to "the default option"). */
  onSelect: (id: string) => void;
  /** Click handler for the radio dot — mark `id` as the new default. */
  onSetDefault?: (id: string) => void;
}

/**
 * Toolbar split-button widget — main button on the left, chevron caret on
 * the right opening a dropdown panel of options. 1:1 with GitKraken's
 * custom toolbar SplitButton (`/tmp/gk-bundle-pretty.js:264340-264466`),
 * scaled down: header subtitle, radio "set as default" per option, click
 * outside / Escape to dismiss.
 */
export function SplitButton(props: SplitButtonProps) {
  let wrapperEl: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);

  function close() {
    setOpen(false);
  }

  onMount(() => {
    const onDocPointer = (e: MouseEvent) => {
      if (!open()) return;
      if (wrapperEl && !wrapperEl.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    });
  });

  function handleSelect(option: SplitButtonOption) {
    if (option.disabled) return;
    close();
    props.onSelect(option.id);
  }

  function handleSetDefault(e: MouseEvent, option: SplitButtonOption) {
    e.stopPropagation();
    if (option.disabled) return;
    if (props.onSetDefault) props.onSetDefault(option.id);
  }

  return (
    <div class="split-button" classList={{ "split-button--open": open() }} ref={wrapperEl}>
      <button
        type="button"
        class="toolbar__btn split-button__main"
        disabled={props.buttonDisabled}
        onClick={() => {
          if (props.onMainClick) props.onMainClick();
          else setOpen((v) => !v);
        }}
      >
        <span class="toolbar__btn-icon">{props.icon}</span>
        <span class="toolbar__btn-label">{props.label}</span>
      </button>
      <button
        type="button"
        class="toolbar__btn split-button__caret"
        aria-label="Open menu"
        aria-expanded={open()}
        disabled={props.dropdownDisabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          class="split-button__caret-icon"
          classList={{ "split-button__caret-icon--flipped": open() }}
        >
          <IconChevronDown width="10" height="10" />
        </span>
      </button>
      <Show when={open()}>
        <div class="split-button__panel" role="menu">
          <Show when={props.header}>
            {(h) => <div class="split-button__header">{h()}</div>}
          </Show>
          <ul class="split-button__list">
            <For each={props.options}>
              {(option) => (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    class="split-button__option"
                    classList={{
                      "split-button__option--destructive": option.destructive,
                    }}
                    disabled={option.disabled}
                    title={option.tooltip}
                    onClick={() => handleSelect(option)}
                  >
                    <span
                      class="split-button__radio"
                      classList={{
                        "split-button__radio--default": option.id === props.defaultOptionId,
                        "split-button__radio--clickable":
                          props.onSetDefault !== undefined && !option.disabled,
                      }}
                      role="radio"
                      aria-checked={option.id === props.defaultOptionId}
                      title={
                        option.id === props.defaultOptionId
                          ? "This is the default"
                          : props.onSetDefault
                            ? "Set as default"
                            : undefined
                      }
                      onClick={(e) => handleSetDefault(e, option)}
                    >
                      <span class="split-button__radio-dot" />
                    </span>
                    <span class="split-button__option-label">{option.label}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}
