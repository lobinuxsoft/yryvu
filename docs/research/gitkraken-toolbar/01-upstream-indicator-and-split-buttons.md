# GitKraken Toolbar — UpstreamIndicator y SplitButton (Pull/Push)

> Reverse-engineering del bundle GK (`/tmp/gk-bundle-pretty.js`, 414k líneas).
> Todas las referencias `bundle:LINE` apuntan a ese archivo, ya beautified.
> Este doc es una guía algorítmica para replicar la UX en chajá. **No copiar código verbatim**.

---

## 1. Resumen ejecutivo

- **UpstreamIndicator** (módulo `42076`, `bundle:156887-156908`) es un componente puro y pequeño: dos pills "ahead/behind" con flecha, sin handler propio. Solo se renderiza si `ahead || behind`. **No hace pull/push por sí mismo.**
- El tooltip "Double-click to pull/push changes" (`bundle:90938-90940`) está colgado en otro nivel (las strings `UpstreamIndicatorIcon-*Tooltip` se inyectan vía `getUpstreamIndicatorIconsAndTooltipsForRef` en `bundle:401296`, sobre el ref del Graph/RefBar). El componente del left-panel (`bundle:54837`) lo usa como tercer icono pero el `onDoubleClick` del row hace **checkout**, no pull (`bundle:48568-48570`). El tooltip miente parcialmente o el dispatcher pull/push vive del lado del Graph; ver Open Questions.
- **El Pull button es un SplitButton custom** (módulo `71602`, `bundle:264340`) — NO el `SplitButton` de react-bootstrap (que también existe en `343845` y se usa en commit-button con dropup). Tiene main button + caret button como dos `<button>` separados, dropdown debajo con header + lista de opciones radio-defaulteables.
- **Push NO es un SplitButton.** Es un `ToolbarButton` simple (`bundle:293359-293369`). Force-push no está en un dropdown: aparece como prompt cuando push falla con `needsForcePush` (`bundle:259943-260005`).
- **Pull dropdown** tiene 4 items en orden fijo: Fetch all, Pull (merge), Pull (FF only), Pull (rebase). El ítem por defecto se persiste en el profile setting `pullType` y se marca con un radio en el dropdown.

---

## 2. UpstreamIndicator anatomy

### Definición (`bundle:156887-156908`, módulo `42076`)

- **Props:** `{ ahead, behind, translate }`. Sin callbacks.
- **Visibility guard:** la función interna `getAheadBehindComponent(label, count)` retorna `null` si `count` es falsy. El root div siempre se renderiza (con `className: "upstream-status fs-1"`); pero los hijos se omiten si no hay nada. En la práctica, el caller ya hace el guard: en el ref del left-panel, el indicador solo se monta si `Boolean(ahead) || Boolean(behind)` (`bundle:54837`).
- **JSX shape:**
  - `<div class="upstream-status fs-1">`
    - `<span class="ahead ml1" data-testid="ahead" title={tr("RefBar-NAhead", n)}>{n>=100?"99+":n}<FontAwesomeIcon icon={["far","long-arrow-up"]} style={{marginLeft:2}}/></span>`
    - `<span class="behind ml1" data-testid="behind" title={tr("RefBar-NBehind", n)}>{...long-arrow-down...}</span>`
- **Severity color:** NO hay clase condicional para "diverged" en este componente. La clase del wrapper es siempre `upstream-status fs-1`. El color se controla 100% desde CSS contra los hijos `.ahead` / `.behind`. El estado "diverged" (ambos > 0) no produce un color extra; solo aparecen los dos pills uno al lado del otro.
- **Cap visual:** el contador hace cap a `99+` cuando es `>= 100`.
- **Tooltip por pill:** cada pill tiene su propio `title` (`RefBar-NAhead`, `RefBar-NBehind`). El tooltip "Double-click to pull/push" NO sale de este componente — sale de `getUpstreamIndicatorIconsAndTooltipsForRef` en otro lado (`bundle:401296-401315`), que se aplica sobre el ref del HEAD en el RefBar (graph).

### Mount points

Solo dos importadores directos de `42076`:

- **Left-panel ref row** (`bundle:54447`, alias `Nr`). Se monta en `getThirdIcon()` del componente Ref del sidebar (`bundle:54809-54865`, hit en `54837`):
  ```
  if (Boolean(ahead) || Boolean(behind))
      return <UpstreamIndicator ahead={Number(ahead)} behind={Number(behind)} translate={tr}/>
  ```
  Está dentro de un row con `onDoubleClick={getOnDoubleClickFn()}` (`bundle:55257`). Para `type === BRANCH`, ese handler dispatcha **`checkoutRefOrOpenWorktree(fullName)`** (`bundle:48568-48570`), no pull/push. Modificadores: si Ctrl/Meta/Shift está pegado, no hace nada.

- **Worktree summary wrapper** (módulo `96219`, `bundle:381789-381842`, alias `mn`). Combina el `workdir-summary-tooltip` (verde si hay WIP) + UpstreamIndicator del worktree (`bundle:381830-381833`). Se importa solo en `bundle:218157`, dentro del row de Worktree del left panel — y el `onDoubleClick` de ese row hace `onWorktreeDoubleClick(worktree)` (cambia worktree activo), no pull/push.

### Conclusión sobre double-click pull/push

En el bundle público, **no hay un wire directo `<UpstreamIndicator onDoubleClick={pull|push}>`**. El tooltip que promete pull/push doble-click se construye en el RefBar del graph (`bundle:401296`) con la clase semántica `dt = "ahead-behind" | "ahead" | "behind"`, que probablemente engancha listeners en otro componente de la RefBar (no extraído en esta pasada). Ver Open Questions §8.

---

## 3. SplitButton class

GK tiene **DOS** SplitButton en el bundle:

### 3.1 react-bootstrap SplitButton (`bundle:343844-343874`, export `xm`)

- Es la clase de Bootstrap 3: `Dropdown.Toggle` + `Button` titulado + `Dropdown.Menu`.
- Props: `bsSize`, `bsStyle`, `title` (label main), `toggleLabel`, `children` (items menu), `onClick`.
- Render shape: `<Dropdown>` con un `<Button>` que es el main (label = `title`), un `<SplitToggle>` (el caret) y `<Dropdown.Menu>{children}</Dropdown.Menu>`.
- **Uso real:** commit-split-button (`bundle:333489`), con `bsStyle="success"`, `dropup`, `pullRight`, items via `<MenuItem>`. NO se usa en la toolbar Pull/Push.

### 3.2 Custom toolbar SplitButton (módulo `71602`, `bundle:264231-264466`)

Este es el que usa el Pull de la toolbar. Es bastante más sofisticado.

**Props (`bundle:264340-264357`):**
- `buttonDisabled: bool` — desactiva el main click (no el caret).
- `dropdownDisabled: bool` — desactiva el caret.
- `defaultOption: string` — id de la opción marcada como default (radio).
- `options: Array<{id, name, disabled?, title?}>` — items del menu.
- `header: string` — texto subtitulo dentro del dropdown.
- `tooltip: string` — overlay tooltip sobre el main.
- `flipCaretOnOpen: bool` — voltea caret-down a caret-up al abrir.
- `loading: bool` — muestra "Loading…" en el panel.
- `onClick`: callback del main button. Si NO se pasa, el botón completo es "no split" — todo el botón abre el dropdown.
- `onSelect(id)`: callback al elegir opción del menu.
- `onSetDefault(id)`: callback del radio "set as default" por opción.
- `id`: id del tooltip.
- `children`: contenido visual del main (label + icono).

**Render shape (modo split, `oa = Boolean(onClick) === true`, `bundle:264376-264406`):**
```
<div class="toolbar-dropdown relative btn-group {open?}" data-testid="toolbar-dropdown-button">
  <button class="btn btn-xs toolbar-btn btn-text {disabled?}" data-testid="split-button-main" onClick={onClick}>
    {children}                      // label + icono (Pull arrow)
  </button>
  <button class="btn btn-xs toolbar-btn btn-text {disabled?}" data-testid="caret" onClick={toggleOpen}>
    <DropdownCaret open={open} flipOnOpen isSplit/>
  </button>

  {open && (
    <div class="flex flex-column" style="position:absolute; top:100%; left:2px; width:250px; max-height:75vh; box-shadow:..."}>
      <div class="p2"><div class="text-secondary fs-2">{header}</div></div>
      {loading && <div>Loading…</div>}
      <div class="overflow-y-auto" data-testid="option-wrapper">
        {options.map(o => <OptionElement option={o} isDefault={o.id===defaultOption} onClick={onSelectInternal} onSetDefault={onSetDefault}/>)}
      </div>
    </div>
  )}
</div>
```

**Modo no-split** (`onClick` omitido, `bundle:264407-264428`): un solo `<button>` que toggle abre el dropdown; click main = abrir.

**`OptionElement` (`bundle:264271-264318`):**
- Row con icono `dot-circle` (default) / `circle` (no default) a la izquierda, label a la derecha.
- Click sobre el icono → `onSetDefault(id)`. `stopPropagation` para que no dispare `onSelect`.
- Click sobre el row → `onSelect(id)` (si no `disabled`).
- Tooltip "Set as default" / "This is the default" sobre el icono.

**`DropdownCaret` (`bundle:264319-264338`):** FA icon `caret-down` / `caret-up` (cuando `flipOnOpen && open`).

**Uso del Pull (`bundle:348861-348880`):**
```
<SplitButton
  buttonDisabled={isFetching || mainBlocked || (detached && current!==FETCH)}
  dropdownDisabled={isFetching || mainBlocked}
  defaultOption={oa.id}              // currentPullType o fallback MERGE
  flipCaretOnOpen
  header={tr("PullOptionsMessage")}
  id="pullOptionsButton"
  onClick={() => onPullOptionSelect(oa.id)}
  onSelect={onPullOptionSelect}
  onSetDefault={(id) => dispatch(setCurrentProfileSetting(["pullType"], id))}
  options={[FETCH, MERGE, FF_ONLY, REBASE]}
  tooltip={oa.disabled ? oa.title : oa.name}
  className="toolbar-pull-button"
>
  <div class="pull-button items-center {fs-4|fs-5}">
    <div>
      {label} <FontAwesomeIcon icon={isFetching ? "circle-notch" : "arrow-to-bottom"} spin={isFetching}/>
    </div>
  </div>
</SplitButton>
```

---

## 4. Pull dropdown items — lista exacta

Definición de constantes en `bundle:194447-194456` (módulo `51230`):

```
pullLabels = {
  FETCH: "PullOptions-FetchAll",
  MERGE: "PullOptions-Merge",
  FF_ONLY: "PullOptions-FastForwardOnly",
  REBASE: "PullOptions-Rebase",
}
pullOptions = {           // id strings que viajan al backend
  FETCH:   "fetch",
  MERGE:   "pull_merge",
  FF_ONLY: "pull_ff_only",
  REBASE:  "pull_rebase",
}
```

Hidratación en el `ToolbarPullButton` (`bundle:348803-348880`):

| # | `id` (backend) | `name` (i18n key)              | Saga / action dispatched                                               | `disabled` cuando        |
|---|----------------|-------------------------------- |------------------------------------------------------------------------|--------------------------|
| 1 | `fetch`        | `PullOptions-FetchAll`          | `dispatch(fetchAll())`                                                 | nunca                    |
| 2 | `pull_merge`   | `PullOptions-Merge`             | `dispatch(pull())` (tipo default = MERGE en `bundle:216447`)           | `getIsInDetachedHeadState` |
| 3 | `pull_ff_only` | `PullOptions-FastForwardOnly`   | `dispatch(pull(null, null, pullOptions.FF_ONLY))`                      | detached HEAD            |
| 4 | `pull_rebase`  | `PullOptions-Rebase`            | `dispatch(pull(null, null, pullOptions.REBASE))`                       | detached HEAD            |

- Orden de aparición en el dropdown: **FETCH, MERGE, FF_ONLY, REBASE** (ese es el orden en que se construye el array `na` en `bundle:348837-348847`).
- **No hay icono por opción** en el OptionElement (solo el radio circle/dot-circle).
- El icono del **main button** sí cambia: `arrow-to-bottom` (idle) ↔ `circle-notch` spinning (durante fetch). El label del main usa `getFetchOrPullLabel` (`bundle:114906-114914`):
  - Si está fetching → `ToolbarLabels-Fetch`.
  - Si `currentPullType === FETCH` → `ToolbarLabels-Fetch`.
  - Else → label de la opción default (Merge/FF/Rebase).

### `getCurrentPullType` y persistencia

- Selector en `bundle:10511`: `getCurrentPullType = getCurrentProfileSetting(state, ["pullType"], default)`. Se persiste por profile (no por repo).
- `onSetDefault` (`bundle:348824-348826`) dispatcha `setCurrentProfileSetting(["pullType"], id)`.
- Valor inicial / fallback: si `currentPullType` no está entre `[MERGE, FF_ONLY, REBASE]`, el dropdown asume `MERGE` como selected (`bundle:114947-114955` — `getPullOptionsForDropdown`).

### `getPullOptionsForDropdown` vs `getPullOptions`

Hay **dos selectors** que devuelven sets diferentes según el caso de uso:

- **`getPullOptions`** (`bundle:114938-114946`): se usa en escenarios "promp the user porque algo falló" (push behind, conflict).
  - Si `currentPullType === FETCH` → devuelve `[MERGE, FF_ONLY, REBASE]` (todas menos FETCH).
  - Else → devuelve solo `[currentPullType]` (1 ítem).
- **`getPullOptionsForDropdown`** (`bundle:114947-114955`): se usa SOLO para el toolbar dropdown UI.
  - Siempre devuelve `[MERGE, FF_ONLY, REBASE]` con `selected` flag para uno (currentPullType o MERGE como fallback). **NO incluye FETCH**, pero el `ToolbarPullButton` lo prepende manualmente.

### Force pull

**No existe en el dropdown del Pull.** Buscado `forcePull`, `force-pull`, `pull --force`: nada. La operación "force pull" en GK se realiza fuera de este menu (probablemente vía menu contextual de branch → "Reset hard to upstream" o similar). Ver Open Questions §8.

---

## 5. Push dropdown items

**No hay dropdown.** El Push es `ToolbarButton` simple (`bundle:293359-293369`):

```
<ToolbarButton
  disabled={isInDetachedHeadState}
  iconName={["far", "arrow-from-bottom"]}
  isMainButton
  isTooltipMessage
  label="Push"
  onClickFunction={() => dispatch(push())}
  spinAction={isPushing}
  testId="button-toolbar-push"
  tooltipId="pushButtonTooltip"
  tooltipTranslationKeyOrMessage={pushTooltip}
/>
```

Tooltip dinámico (`bundle:293328`):
- Detached HEAD → `Toolbar-PushNotAvailableInDetachedHead`.
- Branch tracking remote → `PushToButtonTooltip` (con upstream shorthand).
- Else → `PushButtonTooltip`.

### Force push (con / sin lease)

Aparece **reactivamente** durante el push, no como opción explícita en la toolbar:

- Si push falla con `needsForcePush` y la branch está detrás (`bundle:259943-260005`), se abre un **prompt** con tres botones:
  1. "Pull" (o el label de la opción de pull actual) — si solo hay 1 pull option, ejecuta `pull` y luego retry push. Si hay varias, abre un sub-prompt con los pull types disponibles.
  2. "Force Push" (`ForcePushButtonLabel`, `bsStyle: "danger"`) — abre `ConfirmForcePushPrompt` y, si confirma, hace `pushAction()` con flag `+` en el refspec (`bundle:259927`: ``await Ve.push(`${Nr?"+":""}${Dr}:${gr}`, ln)`` ).
  3. Cancel.

- Adicionalmente hay **dos sagas helper** que el menu contextual de branch consume (no la toolbar):
  - `handleForcePushPromptsWithLease` (`bundle:216873-216977`): action `ForcePushWithLeaseButtonLabel`, mensaje `PromptForPush-ConfirmForcePush`, respeta `forcePushSkipSecondWarning` setting (`bundle:216876`). El flag de "with lease" se traduce a `--force-with-lease` en el push.
  - `handleForcePushPromptsWithOutLease` (`bundle:216978-217120`): variante sin lease, action `ForcePushWithoutLeaseButtonLabel`.

Conclusión: en GK, force-push de la toolbar es **fallback reactivo a un push fallido**. Force-push proactivo vive en el menu contextual del branch.

---

## 6. Force pull semántica

**No documentado en el bundle como acción explícita.** Las únicas opciones de pull son MERGE / FF_ONLY / REBASE. Si el usuario quiere "fetch + reset --hard upstream", debe ir al menu contextual del branch (no extraído acá). El equivalente comportamental sería:

```
1. fetch <upstream-remote>
2. git reset --hard <upstream/branch>
```

**No confirmado** que GK exponga esto bajo el label "Force pull" — es una inferencia razonable. Búsquedas: `forcePull`, `force_pull`, `resetHard.*upstream`, no aparecen como opción de UI clara en este pase. Ver Open Questions §8.

---

## 7. Implementation guidance para chajá

### Backend (Rust + Tauri)

Lo que ya tenés (asumiendo el inventario que mencionaste):
- `pull` (tipo configurable: merge / ff-only / rebase) → mapea 1:1 al dropdown.
- `fetch_prune` → cubre "Fetch all" del dropdown.
- `push` con `PushOptions` (#161) cubriendo force / force-with-lease.

Lo que **falta** y vale la pena agregar:

- **`force_pull(branch, upstream)`** = `fetch upstream` + `reset --hard upstream/branch`. Una operación, no dos comandos del usuario. Razón: GK no la expone explícitamente, pero es una request frecuente y tu base ya tiene los building blocks. Surface en chajá como item separado del dropdown del Pull si querés (a diferencia de GK).
- **Selector de pull type por profile** (no por repo). Persistir en config de chajá, equivalente a `currentProfileSetting.pullType`. Default: `merge`.
- **Reactive force-push prompt**: cuando `push` retorna `needsForcePush`/`non-fast-forward`, emitir evento al frontend para mostrar diálogo Pull / Force Push (con lease) / Cancel. Igual que GK.

### Frontend (SolidJS)

**`UpstreamIndicator.tsx`** (replicar 1:1 la versión GK; ~30 líneas):
- Props: `{ ahead?: number; behind?: number; translate?: (key, ...args) => string }`.
- Render: solo si `ahead || behind`. Dos `<span>` con clases `.ahead .behind .ml-1`, cada uno con su FA arrow-up/down y title-tooltip propio.
- Cap visual `99+`.
- **No incluir** el handler doubleclick aquí. Que sea puramente presentacional. El consumidor decide qué hacer con el click (ej. abrir popover de detalles, dispatch pull/push, nada).
- Color de severity: dejar 100% al CSS. No condicionales en el componente.

**`SplitButton.tsx` reusable** (replicar la variante custom de `71602`):
- Props como las definidas en §3.2.
- Dos modos: split (con `onClick`) vs simple-dropdown (sin `onClick`).
- `OptionElement` con radio "set as default" si `onSetDefault` está presente.
- Posicionamiento absoluto del panel (top: 100%, left: 2px, width: 250px, max-height: 75vh).
- Click outside → close (en GK lo hacen via `Fn = ct(6223)` que es probablemente `useClickOutside`).

**Toolbar mount** (sugerido):
- Pull = SplitButton con items `[Fetch all, Pull (merge), Pull (FF only), Pull (rebase), Force pull]` (último es agregado de chajá; ver Decisión abajo).
- Push = botón simple. Force-push solo aparece como prompt reactivo.
- UpstreamIndicator embebido en el row de la branch activa de la sidebar Y en el header del graph (cerca del nombre del HEAD), igual que GK. Single-click sin acción; double-click = ir a "compare with upstream" / abrir popover de detalles. **No** atar pull/push al double-click — es una mala UX (hidden action, descubrimiento solo via tooltip).

**Decisión:** Force pull en el dropdown del Pull, ¿sí o no?
- A) Sí, como 5to item con icono de warning y bsStyle danger — ahorra clics, riesgo de tap accidental.
- B) No, solo en menu contextual del branch (como GK) — más conservador, menos descubrible.
- Rec: **A** porque chajá apunta a workflows rápidos y ya tenés UI de confirm prompt; el modelo "siempre confirmar destructive" mitiga el riesgo. Razón secundaria: GK lo esconde porque su userbase incluye casual users, vos no.

### CSS variables a expor

GK usa: `--toolbar__bg2`, `--checked-out` (highlight de default option), `--wip-status`, `--fs-3`. Replicalas en tu theme system.

---

## 8. Open questions

1. **Tooltip "Double-click to pull/push" — ¿quién dispatcha?** El tooltip se construye en `bundle:401296-401315` (`getUpstreamIndicatorIconsAndTooltipsForRef`) y se aplica a refs del HEAD en el graph (`bundle:401465`). Pero ningún `onDoubleClick` extraído en este pase dispatcha pull/push. Hipótesis: el dispatcher vive en el componente `RefBar` o `RefBadge` del graph, que no se examinó acá. **Si querés implementar esa UX, hay que extraer un segundo bundle**: buscar `onDoubleClick` cerca de los símbolos `getRefsForBreadcrumbs`, `RefBar-NAhead`, o el módulo donde `getUpstreamIndicatorIconsAndTooltipsForRef` (módulo no identificado, alrededor de 401296) consume su output.

2. **Force pull — ¿GK lo expone?** No encontrado. Probablemente vive en el context-menu de branch como "Reset to upstream" o similar. Habría que extraer el módulo de menus contextuales (buscar `popupRefMenu` en `bundle:48609`).

3. **Single-click sobre UpstreamIndicator.** El componente no liga `onClick`. Si el row del ref tiene listener, single-click hace selección normal del row (selecciona la branch, la "checks out" como contexto del graph pero no hace `git checkout`). No abre popover.

4. **Severity color "diverged".** No hay clase explícita. Si querés que el indicador se ponga rojo/naranja cuando ambos > 0, necesitás CSS custom: `.upstream-status:has(.ahead):has(.behind) { color: var(--color-warning); }`.

5. **Worktree summary tooltip.** El módulo `96219` lo agrupa con UpstreamIndicator. Si chajá soporta worktrees pronto, replicar ese wrapper también.

6. **`PullOptionsMessage` traducción.** No extraída en este pase. Inferencia: "Choose a pull strategy" o similar. Buscar en otro bundle de strings.

7. **"Set as default" persistence scope.** En GK es por **profile** (sus profiles son setups multi-cuenta). chajá probablemente debería persistirlo por **app** (1 setting global) salvo que tengas profiles. Decisión a tomar.

8. **Force-push en commit-button.** El SplitButton de react-bootstrap (commit-split-button, `bundle:333489`) tiene `menuOptions` configurables. Posiblemente "Commit and Push" / "Commit, Push and Tag" están ahí. No examinado en este pase.
