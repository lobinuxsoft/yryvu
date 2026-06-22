// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";

import { readFileBytes, type FileBytes, type FileContentSource } from "../../ipc";

export interface ImageSources {
  repoPath: string;
  path: string;
  /// "before" side — the parent commit / index / HEAD blob.
  old: FileContentSource;
  /// "after" side — the commit / working-tree / index blob.
  new: FileContentSource;
}

interface ImageDiffViewProps {
  sources: ImageSources;
}

/// Decode base64 → bytes → blob URL. Returns `null` for the missing side
/// (added/deleted file) so the caller renders the `Merge-NoImage`
/// placeholder. Mirrors GitKraken's blob-URL image source.
function toBlobUrl(bytes: FileBytes | undefined): string | null {
  if (!bytes || bytes.missing || !bytes.dataBase64) return null;
  const binary = atob(bytes.dataBase64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([buf], { type: bytes.mime || undefined }));
}

/// Derive a revocable blob URL from a bytes resource. The URL is revoked
/// when the effect re-runs (new content) or the component unmounts, so
/// no object URLs leak — the discipline issue #60 calls out.
function useBlobUrl(bytes: () => FileBytes | undefined): () => string | null {
  const [url, setUrl] = createSignal<string | null>(null);
  createEffect(() => {
    const next = toBlobUrl(bytes());
    setUrl(next);
    onCleanup(() => {
      if (next) URL.revokeObjectURL(next);
    });
  });
  return url;
}

function NoImage(): JSX.Element {
  return (
    <div class="image-diff__no-image" data-testid="Merge-NoImage">
      No image
    </div>
  );
}

/// `fileDataTypes.IMAGE` viewer (research doc 09). Always-visible
/// side-by-side pair (old left / new right) plus a single overlay toggle
/// that draws the old image as a semi-transparent layer over the new.
/// No onion-skin / slider / difference mode — GitKraken ships exactly
/// these two controls.
export function ImageDiffView(props: ImageDiffViewProps): JSX.Element {
  const [oldBytes] = createResource(
    () => props.sources,
    (s) => readFileBytes(s.repoPath, s.path, s.old),
  );
  const [newBytes] = createResource(
    () => props.sources,
    (s) => readFileBytes(s.repoPath, s.path, s.new),
  );
  const oldUrl = useBlobUrl(() => oldBytes());
  const newUrl = useBlobUrl(() => newBytes());

  const [overlay, setOverlay] = createSignal(false);
  const loading = () => oldBytes.loading || newBytes.loading;
  const canOverlay = () => oldUrl() !== null && newUrl() !== null;

  return (
    <div class="image-diff">
      <div class="image-diff__toolbar">
        <button
          class="image-diff__overlay-toggle"
          type="button"
          data-testid="DiffImage-ShowDiffOverlay"
          title="Diff overlay old image"
          aria-pressed={overlay()}
          disabled={!canOverlay()}
          onClick={() => setOverlay((v) => !v)}
        >
          Overlay
        </button>
      </div>

      <Show
        when={!loading()}
        fallback={<div class="diff-file__notice">Loading images…</div>}
      >
        <div class="image-diff__panes">
          <figure class="image-diff__pane">
            <figcaption class="image-diff__label">Old image</figcaption>
            <Show when={oldUrl()} fallback={<NoImage />}>
              <img
                class="image-diff__img"
                data-testid="DiffImage-OldImage"
                src={oldUrl()!}
                alt="Old version"
              />
            </Show>
          </figure>
          <figure class="image-diff__pane">
            <figcaption class="image-diff__label">New image</figcaption>
            <Show when={newUrl()} fallback={<NoImage />}>
              <div class="image-diff__overlay-wrap">
                <img
                  class="image-diff__img"
                  data-testid="DiffImage-NewImage"
                  src={newUrl()!}
                  alt="New version"
                />
                <Show when={overlay() && oldUrl()}>
                  <img
                    class="image-diff__img image-diff__overlay"
                    src={oldUrl()!}
                    alt=""
                    aria-hidden="true"
                  />
                </Show>
              </div>
            </Show>
          </figure>
        </div>
      </Show>
    </div>
  );
}
