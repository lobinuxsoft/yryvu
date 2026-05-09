// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal, Show } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";

import logoUrl from "../../assets/logo.svg";
import { Dialog } from "../Dialog";

const [open, setOpen] = createSignal(false);

export function openAbout(): void {
  setOpen(true);
}

export function closeAbout(): void {
  setOpen(false);
}

export function About() {
  const [version] = createResource(open, async (isOpen) => {
    if (!isOpen) return "";
    return await getVersion();
  });

  return (
    <Dialog open={open()} title="About Yryvu" onClose={closeAbout}>
      <div class="about">
        <img class="about__logo" src={logoUrl} alt="Yryvu logo" />
        <h2 class="about__name">Yryvu</h2>
        <Show when={version()}>
          <p class="about__version">v{version()}</p>
        </Show>
        <p class="about__tagline">
          jote (<i>Coragyps atratus</i>) en guaraní
        </p>
        <p class="about__description">
          The scavenger that circles overhead — surveys the forest, spots
          every change, brings news back to the perch. Yryvu carries your
          commits, branches and merges the same way.
        </p>
        <p class="about__stack">
          Native Git client · Tauri · SolidJS · Rust
        </p>
        <div class="about__credits">
          <span class="about__credits-row">
            <span class="about__credits-label">Author</span>
            <span class="about__credits-value">lobinuxsoft</span>
          </span>
          <span class="about__credits-row">
            <span class="about__credits-label">License</span>
            <span class="about__credits-value">AGPL-3.0-or-later</span>
          </span>
          <span class="about__credits-row">
            <span class="about__credits-label">Repository</span>
            <span class="about__credits-value">github.com/lobinuxsoft/yryvu</span>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
