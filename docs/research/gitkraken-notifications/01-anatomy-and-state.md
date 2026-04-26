# GitKraken Notifications — Anatomy & State

Spike de un solo doc para guiar la implementación del sistema de notificaciones
in-app de chajá (issue #109). Reverse engineering del bundle GitKraken 12.0.1
beautified en `/tmp/gk-bundle-pretty.js`.

## 1. Resumen ejecutivo

- GitKraken NO tiene un único "NotificationService". Coexisten **tres sistemas
  ortogonales**:
  1. **Toasts transitorios** (`react-hot-toast`) para feedback de operaciones
     Git locales (push, fetch, errors, success). Memory only, max 20
     simultáneos, auto-dismiss por severity.
  2. **Cloud Notifications** (`notificationShared` slice + bell icon + history
     panel) para mensajes server-pushed (app updates, marketing, project
     shared, trial events). Persisted, mark-read, delete, filter.
  3. **notifications-service-client** (Centrifuge/WebSocket) que alimenta el
     sistema 2 con eventos en tiempo real.
- El "banner inline" placeholder de chajá corresponde solo al sistema 1. El
  sistema 2 (bell + history) es lo que falta por completo.
- Los toasts NO crean entradas en el history panel — son sistemas
  independientes. Confirmado: `showToast` no escribe nunca en
  `notificationsByIdMap`.
- No hay categorías/mute por tipo de evento Git. La única preferencia es
  `marketing.enabled` y `local.showDesktopNotifications` (notificaciones
  nativas de OS).
- Severities solo cuatro: `INFO`, `SUCCESS`, `ERROR`, `LOADING`. `LOADING` es
  un caso especial (spinner SVG, sin auto-dismiss).

## 2. Toast manager — `showToast` saga

Archivo: `/tmp/gk-bundle-pretty.js:3140-3219` (módulo `692`).

Símbolos exportados:

- `at.hideToast` — `(toastId) => saga` que llama `toast.dismiss(toastId)` de
  `react-hot-toast`.
- `at.CLOSE_TOAST` — `(dispatch, toastId) => void`. Wrapper para uso desde
  onClick handlers en componentes.
- `at.showToast` — el push principal. Acepta el siguiente schema (extraído de
  la destructuring en `:3171-3179`):

```ts
interface ShowToastParams {
  toastId?: string;             // si no se pasa, genera uno con uuid v4
  variant: "INFO" | "SUCCESS" | "ERROR" | "LOADING";
  title?: string;               // si vacío y variant=ERROR, usa "Error-Generic" i18n
  content?: string | ReactNode; // mensaje secundario; puede ser markdown/JSX
  buttons?: ToastButton[];      // botones inline; ver §5
  dismissable?: boolean | "X_ONLY";
  duration?: number;            // ms; default depende de variant
  telemetry?: {
    message: string;            // i18n key del error, para metrics
    additionalErrorContext?: Record<string, string | number>;
  };
}
```

- `at.showToastWithRefKeyContainer` — variante para guardar el `toastId` en un
  `refKey` mutable (útil para sustituir toasts de loading por su resultado
  final).

Comportamiento clave del saga (`/tmp/gk-bundle-pretty.js:3170-3211`):

- `dismissable` por defecto: `true` para todas las variants **excepto**
  `ERROR` cuando se usa `X_ONLY` (cierre solo con la X, no con click en el
  cuerpo). Lógica: `dr ?? (dt !== ERROR || X_ONLY)`.
- `duration` por defecto: `TOAST_DURATION_DEFAULT` (10s). Override por
  variant ver §4.
- Si `variant === ERROR`:
  - Llama `logError(title, content)` (`:3184`).
  - Si `telemetry.message` está presente, registra métrica
    `ERROR_TOAST_SHOWN` con primeros 9 entries del
    `additionalErrorContext` (truncado a 200 chars cada valor) — ver
    `/tmp/gk-bundle-pretty.js:3185-3193`.
  - Si tanto `title` como `content` son falsy, usa `"Error-Generic"` i18n key.
- Filtro **MUST_HAVE_REPO**: si `title` o `content` contienen el string
  `MUST_HAVE_REPO`, NO se muestra el toast (`:3195-3196`). Es un guard
  contra errores que solo aplican cuando hay repo abierto.
- Renderiza `<ToastComponent>` (módulo `41864`) y lo pasa a
  `dn.toast(element, { id, duration })` que es el `toast()` global de
  `react-hot-toast`.

## 3. State shape

GitKraken tiene **dos slices** + el state interno de `react-hot-toast`.

### 3.1 `react-hot-toast` (memoria, no Redux)

`/tmp/gk-bundle-pretty.js:156911-157160` (módulo `42086`).

```ts
interface ToasterStore {
  toasts: ToastInternal[];   // FIFO, max 20 (slice(0, 20))
  pausedAt: number | undefined;
}

interface ToastInternal {
  id: string;
  type: "blank" | "error" | "success" | "loading" | "custom";
  message: string | ReactNode;
  duration?: number;
  pauseDuration: number;
  visible: boolean;
  createdAt: number;
  ariaProps: { role: string; "aria-live": string };
  // ...customizable style/icon/className
}
```

Reducer (módulo interno `H`, `:156979-157040`) con 7 action types:

| Type | Effect |
|---|---|
| `0` | ADD_TOAST: prepend + truncate to 20 |
| `1` | UPDATE_TOAST: merge by id |
| `2` | UPSERT_TOAST: update if exists else add |
| `3` | DISMISS_TOAST: marca `visible: false` (animación de salida) y agenda removal en 1000ms |
| `4` | REMOVE_TOAST: filter por id (o todos si id es undefined) |
| `5` | START_PAUSE: setea `pausedAt` |
| `6` | END_PAUSE: clear `pausedAt` y suma diff a cada `pauseDuration` |

Pause-on-hover: el `<Toaster>` hookea mouseenter/leave a nivel container y
dispatcha types 5/6.

### 3.2 `notificationShared` slice (Redux, persisted)

Init: `/tmp/gk-bundle-pretty.js:297014-297023` (módulo `77558`).

```ts
interface NotificationSharedState {
  cloudSettings: CloudNotificationSettings | null;
  isCheckingToPostLocalNotifications: boolean;
  isNotificationSettingsLoading: boolean;
  nextNotificationId: number;          // counter para local notifications
  notificationsByIdMap: Record<string, Notification>;
  postedLocalNotifications: Record<LocalNotificationId, boolean | string>;
  waitingForCloudNotifications: boolean;
}

interface Notification {
  notificationId: string;
  event: "appUpdate" | "general" | "callToAction" | "cliFeatureGained"
       | "trialEnded" | "trialStarted" | "projectShared";
  contentType: "feature" | "marketing" | "system";
  payload: object;                     // shape varia por event
  fallback?: string;                   // markdown si no se reconoce el event
  createdAt: Date;
  readAt: Date | null;                 // null = unread
  deletedAt: Date | null;              // soft delete (no se renderiza)
}
```

Selectors (`/tmp/gk-bundle-pretty.js:144860-144906`, módulo `37879`):

| Selector | Devuelve |
|---|---|
| `getNotificationsByIdMap` | el map crudo |
| `getFilteredNotificationByIdMap` | filtra por `getNotificationFilter` (ALL/READ/UNREAD) |
| `getFilteredNotificationOrder` | array de IDs ordenado por `createdAt` desc |
| `getUnreadNotificationCount` | size de `!readAt && !deletedAt` |
| `getUnreadNotificationCountString` | `>= 50 ? "50+" : count` |
| `getHasUnreadNotifications` | bool, true si count > 0 |
| `getHasUnreadNotificationsVisible` | bool sobre el filtered map |
| `getHasReadNotificationsVisible` | bool sobre el filtered map |
| `getNotificationFilter` | "All" \| "Read" \| "Unread" (de appSettings) |
| `getCloudNotificationSettings` | el `cloudSettings` para preferences UI |
| `getShowDesktopNotifications` | bool para OS-native notifications |

Action creators / sagas (`/tmp/gk-bundle-pretty.js:89786-89914`, módulo
`21714`). Todas se delegan al main process vía IPC channels:

| Action | IPC channel |
|---|---|
| `markNotificationSeen(id, dateOrNull)` | `MARK_NOTIFICATION_SEEN` |
| `markAllNotificationsAsSeen(dateOrNull)` | `MARK_ALL_NOTIFICATIONS_AS_SEEN` |
| `removeNotification(id)` | `REMOVE_NOTIFICATION` (soft delete vía `deletedAt`) |
| `requestNotificationsSync()` | `REQUEST_NOTIFICATIONS_SYNC` |
| `refreshNotificationData()` | `REFRESH_NOTIFICATION_DATA` |
| `loadNotificationSettings()` | `LOAD_NOTIFICATION_SETTINGS` |
| `updateNotificationSettings(payload)` | `UPDATE_NOTIFICATION_SETTINGS` |
| `setDesktopNotificationSetting(bool)` | `SET_DESKTOP_NOTIFICATION_SETTING` |
| `postLocalNotification(notif)` | `POST_LOCAL_NOTIFICATION` |
| `openNotificationMenu()` | `dispatch(SetIsNotificationMenuOpen(true))` |
| `closeNotificationMenu()` | `dispatch(SetIsNotificationMenuOpen(false))` |

Constantes en `/tmp/gk-bundle-pretty.js:117753-117806` (módulo `30728`):

```ts
notificationType = { SYSTEM: "system", USER: "user" };
contentType = { FEATURE: "feature", MARKETING: "marketing", SYSTEM: "system" };
event = {
  APP_UPDATE: "appUpdate",
  GENERAL: "general",
  CALL_TO_ACTION: "callToAction",
  CLI_FEATURE_GAINED: "cliFeatureGained",
  TRIAL_ENDED: "trialEnded",
  TRIAL_STARTED: "trialStarted",
  PROJECT_SHARED: "projectShared"
};
NotificationFilter = { ALL: "All", READ: "Read", UNREAD: "Unread" };
DESKTOP_NOTIFICATION_IGNORED_TIMEOUT = 20_000;  // 20s para que la OS-native marque como ignored
LONG_WAIT_THRESHOLD = 5_000;
```

### 3.3 UI slice — `ui.notifications`

`/tmp/gk-bundle-pretty.js:309703-309705`:

```ts
ui: {
  notifications: {
    isMenuOpen: boolean
  }
}
```

Action: `SetIsNotificationMenuOpen(bool)` (módulo `15859`).

### 3.4 `notification` slice (preferences)

Persistido en `appSettings.notification` (`/tmp/gk-bundle-pretty.js:363122`):

```ts
notification: {
  toastPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
                                                  // default: BOTTOM_LEFT
  filter: "All" | "Read" | "Unread";              // default: ALL
  settings: {
    local: { showDesktopNotifications: boolean };
    cloud: { marketing: { enabled: boolean } };
  };
}
```

## 4. Severity levels

Constantes: `/tmp/gk-bundle-pretty.js:331499-331526` (módulo `83583`).

```ts
TOAST_DURATION_VERY_SHORT = 3_000;    // 3s
TOAST_DURATION_SHORT = 5_000;         // 5s
TOAST_DURATION_DEFAULT = 10_000;      // 10s
TOAST_DURATION_FOREVER = Infinity;
X_ONLY = "X_ONLY";

toastVariants = {
  ERROR: "ERROR",
  INFO: "INFO",
  LOADING: "LOADING",
  SUCCESS: "SUCCESS"
};
```

Mapeo color/icon en el componente (`/tmp/gk-bundle-pretty.js:156151-156205`):

| Variant | Color (CSS var) | Icon | Default duration | Bootstrap btn style |
|---|---|---|---|---|
| `INFO` | `var(--blue)` | `iconIds.informationCircle` | 10s (DEFAULT) | `primary` |
| `SUCCESS` | `var(--green)` | `iconIds.checkCircle` | 10s (DEFAULT) | `success` |
| `ERROR` | `var(--red)` | `iconIds.xCircle` | 10s (DEFAULT) — pero los call sites suelen pasar `TOAST_DURATION_FOREVER` con `X_ONLY` para errores graves | `danger` |
| `LOADING` | `var(--blue)` | spinner SVG inline (rotación 360° infinita) | 10s default pero los call sites suelen actualizar el toast para reemplazarlo por SUCCESS/ERROR cuando termine la op | `default` |

**Nota**: a diferencia de la convención típica, GitKraken NO baja el default
para `ERROR` automáticamente — confía en que el caller pase
`duration: TOAST_DURATION_FOREVER` + `dismissable: X_ONLY` cuando lo amerita
(ej. push failure con permissions error, ver `:85687-85688`). Los success
cortos (branch deleted, fetch ok) sí pasan `TOAST_DURATION_VERY_SHORT` o
`TOAST_DURATION_SHORT` explícitamente (`:85630`, `:85651`).

No hay sound. No hay focus behavior diferenciado. La animación de entrada/
salida la decide la `position` del toast: `enter-animation-right`/`-left`
durante 0.5s ease (`/tmp/gk-bundle-pretty.js:104429-104430`).

## 5. Toast component anatomy

Componente: `/tmp/gk-bundle-pretty.js:156103-156256` (módulo `41864`).

```
┌─────────────────────────────────────────────────────┐
│ [ICON]  Title                                  [X]  │
│ severity│ Content (puede ser ReactNode/markdown)    │
│ accent  │ ┌─────────┐ ┌─────────┐                  │
│  bar    │ │ Btn 1   │ │ Btn 2   │                  │
│         │ └─────────┘ └─────────┘                  │
└─────────────────────────────────────────────────────┘
```

DOM real (`:156213-156254`):

```jsx
<div
  className="gk-hot-toast"
  data-test-class={`gk-toast-${variant}`}
  onClick={dismissable && dismissable !== X_ONLY ? closeToast : undefined}
>
  <div className="toast-icon" style={{ backgroundColor: severityColor }}>
    {severityIcon}
  </div>
  <div className="toast-content">
    <div style={{ display: "flex", flexDirection: "column",
                  color: "white", padding: 8 }}>
      <span className="fs-4 mb2"
            style={{ color: "var(--text-selected)",
                     wordBreak: "break-word" }}>
        {title}
      </span>
      <span className="fs-3 mb1"
            style={{ color: "var(--text-secondary)",
                     wordBreak: "break-word" }}>
        <ErrorBoundary><div>{content}</div></ErrorBoundary>
      </span>
    </div>
    {buttons?.length > 0 && (
      <ErrorBoundary>
        <div className="toast-buttons">
          <ToastButtons ... />
        </div>
      </ErrorBoundary>
    )}
  </div>
  {dismissable && (
    <div className="toast-dismiss">
      <span className="pointer text-secondary hover-text"
            data-test-class="close-toast-button"
            onClick={closeToast}>
        <FontAwesomeIcon icon={["far", "times"]}
                         className="fs-5 mt1 mb1 mr1 ml1" />
      </span>
    </div>
  )}
</div>
```

Características:

- **Clickeable como dismiss**: si `dismissable === true` (no `X_ONLY`), click
  en cualquier parte del toast lo cierra. Si `X_ONLY`, solo la X cierra.
- **Severity accent**: bloque vertical izquierdo con el `backgroundColor`
  igual a la CSS var de la severity.
- **Buttons inline**: full-width 100% con `key="btn-${i}"`, `bsStyle` puede
  ser per-botón (`button.variant`) o caer en el default por severity.
  Wrapped en `ErrorBoundary` para que un crash en JSX del button no rompa
  todo el toast (`Fn.default` en `:156243`).
- **Content protegido**: también wrapped en `ErrorBoundary`. Esto answers la
  pregunta del edge case "qué pasa si el callback explota": el toast no
  desaparece, solo el content se reemplaza por el fallback del boundary.
- **No hay avatar nativo**: el componente del toast en sí no tiene slot de
  avatar/imagen (a diferencia del notification list item del history panel,
  que sí tiene avatar — ver §7).
- **No hay progress bar**: tampoco. El único feedback de progreso es la
  variant `LOADING` con spinner.

### 5.1 Action button schema

`/tmp/gk-bundle-pretty.js:156118-156128`:

```ts
interface ToastButton {
  label: string;
  variant?: "primary" | "success" | "danger" | "default" | ...; // bsStyle
  onClick: (dispatch: Dispatch, toastId: string) => void;
}
```

El `onClick` recibe `dispatch` y el `toastId` corriente. **Patrón canónico**
para que el botón ejecute una acción y cierre el toast:

```js
onClick: (dispatch, toastId) => {
  dispatch(openExternal(url));
  CLOSE_TOAST(dispatch, toastId);
}
```

Visto en `/tmp/gk-bundle-pretty.js:85682-85684` y muchos otros call sites.

### 5.2 Container — `<Toaster>`

Montado en el root de la app (`/tmp/gk-bundle-pretty.js:104439-104450`):

```jsx
<div className="gk-hot-toast-container">
  <Toaster position={toastPosition}>
    {(toast) => (
      <ToastBar
        className="toast-bar"
        style={{
          padding: 0,
          background: "transparent",
          animation: toast.visible ? enterAnim : exitAnim,
        }}
        toast={toast}
      />
    )}
  </Toaster>
</div>
```

`toastPosition` viene de `appSettings.notification.toastPosition` y default
`BOTTOM_LEFT`. Las animaciones cambian de `*-right` a `*-left` según la
position.

## 6. Trigger points

Hay **432 invocaciones** de `showToast` en el bundle (medido con grep). Solo
documento las representativas. Los wrappers están en
`/tmp/gk-bundle-pretty.js:85563-85800` (módulo `20549`) — vale la pena
leerlos como catálogo:

| Wrapper | Variant | Title key | Duration | Botones |
|---|---|---|---|---|
| `showBranchesDeletedToast(name, count)` | SUCCESS | "Notification-DeletedBranch" o "Notification-DeletedNBranches" | SHORT (5s) | — |
| `showPushSuccessToast(ref, remote, prRef?)` | SUCCESS | "Notification-PushedSuccessfully" | VERY_SHORT (3s) o SHORT (si hay PR) | — |
| `showPushFailureToast(err, refName?)` | ERROR | "Error-PushFailed" | FOREVER + X_ONLY si hay maybeOrgOwner; default si no | "Open OAuth URL" si maybeOrgOwner |
| `showInitRepoOnServiceSuccessToast(svc, url)` | SUCCESS | "Repo-SuccessfullyCreatedRepo" | DEFAULT | "ViewOnHostingService" |
| `showInsufficientServicePermissionsToast(svc)` | ERROR | "Error-NeedUpgradedPermissions" | FOREVER + X_ONLY | "Open Integrations preferences" |
| `showSshKeyBeingUsedForUnmodifiableServiceToast(svc, url?)` | INFO | "Notification-SSHKeyBeingUsed" | FOREVER + X_ONLY | "Manage SSH Keys" si url |
| `showLoginToProviderToast(...)`, `showSSLCertErrorToast(...)`, `showRefreshTokenExpiredToast(...)`, `showGKDotDevToast(...)`, `showCustomThemeDeprecationToast(...)`, `showClaudeCodeHooksAddedToast(...)` | varios | varios | varios | varios |

Trigger points inline (no wrappers) — patterns típicos:

| Op | Source | Lifecycle | Variant + title |
|---|---|---|---|
| GitFlow start (feature/release/hotfix) | `:7992-8095` | `failed` / `succeeded` | ERROR `Error-GitFlowStart{Feature,Release,Hotfix}Failed` / SUCCESS `GitFlow-Start{Feature,Release,Hotfix}Success` |
| GitFlow init | `:8096-8134` | `failed` / `succeeded` | ERROR `GitFlow-Init-Failure` / SUCCESS `GitFlow-Init-Success` |
| GitFlow finish feature | `:8135-...` | similar | similar |
| Cherrypick / Revert / Patch | `:37198-37303` | inline en saga | SUCCESS `Notification-{Cherrypick,Revert,PatchApply}Successful` / ERROR `Error-{Cherrypick,Revert,PatchApply}Failed` |
| Refresh tokens / network errors | `:22463`, `:22495`, `:22522`, `:27902`, `:28106` | inline | ERROR genérico |
| Stash apply / drop / branch CRUD | `:36145`, `:36184`, `:36236`, `:36415`, `:36673`, `:36743`, `:36803`, `:37170`, `:37246`, `:37280`, `:37293` | inline | mix SUCCESS / ERROR |
| Settings sync error | `:43908`, `:44016` | catch | ERROR |
| AI / Misc UX | `:11895`, `:22463`-`:22523` | spawn | varía |
| Workspace fetch/pull | `:86446-86447` (constantes `Workspace-FetchSuccess`, `Workspace-PullSuccess`) | mensaje agrupado | SUCCESS |

**Patrón consistente** (`:8000-8016` y muchos otros):

```js
lifecycle: {
  *failed(err) {
    const t = yield select(getTranslationFn);
    yield put(showToast({
      variant: ERROR,
      title: t(errorLabel, name),
      content: getErrorMessage(err, t),
      telemetry: { message: errorLabel },
    }));
  },
  *succeeded() {
    const t = yield select(getTranslationFn);
    yield put(showToast({
      variant: SUCCESS,
      title: t(successLabel, name),
    }));
  }
}
```

Es decir, el pattern es: **el toast se dispara desde el saga lifecycle hook**,
no como effect side-channel. Para chajá esto se traduce a: dispatch desde el
backend Rust (Tauri command result handler) → store frontend → toast manager.

## 7. History panel — Cloud Notifications dropdown

Panel completo: `/tmp/gk-bundle-pretty.js:600-802` (módulo numerado `~166`,
truncado en el bundle, pero es el componente del dropdown).

### 7.1 Layout

```
┌────────────────────────────────────────────────────────┐
│ [⚠?]  Notifications  [Filter ▾]              [⋮]      │ ← header
├────────────────────────────────────────────────────────┤
│ [⚠ "Waiting for cloud..."]                             │ ← banner condicional
├────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────┐  │
│ │ [avatar] Username   2h ago   [👁/👁‍🗨] [🗑]        │  │ ← item (read = greyed)
│ │ ↳ markdown content + optional CTA button         │  │
│ ├──────────────────────────────────────────────────┤  │
│ │ ...                                              │  │
│ └──────────────────────────────────────────────────┘  │
│ (scrollable; maxHeight = window.height - chrome - 16) │
└────────────────────────────────────────────────────────┘
```

Cuando no hay items, sustituye la lista por un texto centrado:
"NotificationMenu-{All,Read,Unread}-Empty" (`:719-728`, `:795-800`).

Empieza con `<DropdownButton>` para filtro (All/Read/Unread) y un menú
overflow `[⋮]` con tres acciones (`:751-786`):

- **Mark as read** — dispatcha `markAllNotificationsAsSeen(new Date)`. Disabled
  si no hay unread visibles.
- **Mark as unread** — dispatcha `markAllNotificationsAsSeen(null)`. Disabled
  si no hay read visibles.
- **Settings** — cierra el menú y abre `PreferenceView` tab `NOTIFICATIONS`.

Si el user está logueado pero el sync service está down, muestra warning icon
con tooltip "NotificationMenu-CantSync" (`:734-746`).

### 7.2 maxHeight con zoom-aware

`/tmp/gk-bundle-pretty.js:694-699`:

```js
const oa = (Ve.fullScreen || Ve.maximized ? window.outerHeight : Ve.height)
         - (CURRENT_SYSTEM_TITLE_BAR_HEIGHT + TABS_BAR_HEIGHT + 40
            + STATUS_BAR_HEIGHT + 16);
if (zoom !== 1) {
  const delta = zoom - 1;
  maxHeight = delta < 0 ? oa + oa * -delta : oa - oa * delta;
}
```

Decisión: el panel se adapta al zoom level del user (preferencia del
profile). chajá puede simplificar esto a `max-height: calc(100vh - 200px)`
salvo que tengas zoom configurable.

### 7.3 Item rendering

Componente: `/tmp/gk-bundle-pretty.js:137609-137792` (módulo `35339`).

Por cada notification del array filtered+sorted:

- **Avatar slot** — default `KEIF_AVATAR` (mascota GitKraken,
  `images/keif-avatar.svg`). Para `event === PROJECT_SHARED`, lo reemplaza
  por icono `["far", "users"]` y muestra el nombre de la org.
- **Username** — default "GitKraken", o `payload.organization.name` para
  PROJECT_SHARED.
- **Timestamp relativo** — "Today", "Yesterday", o fecha formateada. Usa
  `formatDateTime(date, NOTIFICATION_ELAPSED_TIME)` (`:137745`).
- **Mark seen/unseen toggle** — icon `["far", "eye"]` (unread) o
  `["far", "eye-slash"]` (read). Click llama
  `markNotificationSeen(id, readAt ? null : new Date)`.
- **Trash button** — icon `["far", "trash"]` → `removeNotification(id)`
  (que via IPC hace soft-delete con `deletedAt`).
- **Read state styling** — clase `text-disabled toolbar-bg1` cuando readAt.
- **Content render** — switch sobre `notification.event`:
  - `APP_UPDATE` → componente custom con info de la versión + install button.
  - `CALL_TO_ACTION` → markdown + `<Button bsStyle="success">` con
    callback que hace `recordCallToActionMetric` + `closeNotificationMenu` +
    `openExternal(link)` + `markNotificationSeen` (si no estaba seen).
  - `GENERAL` → solo markdown (`<GkMarkdown source={payload.markdown}>`).
  - `TRIAL_ENDED` → componente custom.
  - `TRIAL_STARTED` → componente custom.
  - `PROJECT_SHARED` → componente custom con payload de la project.
  - Si nada matchea y hay `fallback`: muestra el markdown del fallback +
    mensaje "NotificationUI-{Feature,Notification}RequiresUpdate" + UI para
    actualizar la app.
- **Context menu** — `onContextMenu={popupCopyTextMenu}` para copiar texto.

### 7.4 Trash vs read

- **Mark as read** modifica `readAt` solamente, el item sigue visible (con
  estilo "disabled").
- **Trash** marca `deletedAt`. El item se filtra out en el render
  (`if (notification.deletedAt) return null;` en `:702`).

Esto responde el edge case: "diferencia entre toast disappeared vs history
item deleted" — son sistemas independientes. El toast ya desaparece solo;
los notification items requieren accion explícita para ocultarse.

## 8. Bell icon + unread badge

Componente: `/tmp/gk-bundle-pretty.js:224285-224329` (módulo `~58359`).

```jsx
<div className="flex">
  <FontAwesomeIcon
    className="fs-4"
    fixedWidth
    icon={["far", "bell"]}
    style={{ transform: hasUnread ? "rotate(-8deg)" : "" }}
  />
  {hasUnread && (
    <span
      className="bold"
      style={{
        position: "absolute",
        backgroundColor: "var(--blue)",
        color: "var(--white)",
        borderRadius: "50%",
        height: 12, width: 12,
        fontSize: 8,
        lineHeight: "12px",
        textAlign: "center",
        top: 2, right: 2,
      }}
    >
      {unreadCountString}
    </span>
  )}
</div>
```

Detalles:

- Bell rotado **-8°** (left tilt) cuando hay unread — micro-animación visual
  (no es shake/wiggle, es solo un tilt estático).
- Badge: pill circular azul, 12×12px, fontSize 8px, top-right del icon.
- Texto del badge: `getUnreadNotificationCountString` que devuelve `"50+"`
  si count >= 50, sino el número exacto (`/tmp/gk-bundle-pretty.js:144904`).
- Click abre `NotificationMenu` dropdown (controlado por
  `ui.notifications.isMenuOpen`).

Alternativa con `BellIcon` reusable (variant solid sin badge): módulo
`~75550`, `/tmp/gk-bundle-pretty.js:296185-296220`.

## 9. Implementation guidance para chajá

### 9.1 Decisiones de arquitectura recomendadas

**Decisión:** ¿qué patrón de store usar para el sistema de toasts?
A) Store dedicado tipo zustand-like (signal-based en Solid) — sigue 1:1 el
   patrón react-hot-toast pero sin la lib (es ~150 LOC)
B) Reusar el store global de chajá con un slice `toasts` y selectors
Rec: **A** porque el toast queue es un cross-cutting concern que no debería
contaminar el state principal y ya es portable a otras vistas.

**Decisión:** ¿history persistente entre sesiones?
A) Memory-only — toasts y history viven en RAM, mueren al cerrar.
B) Backend persiste history en SQLite/JSON (toasts no, son ephemeral).
Rec: **B** para la history (issue #109 lo pide explícitamente "panel
persistente"), memory-only para los toasts (igual que GitKraken).

### 9.2 Mapping al stack de chajá

| Pieza GitKraken | chajá equivalente |
|---|---|
| `showToast` saga | función `pushToast(opts)` exportada de `src/notifications/toast.ts` que hace dispatch al store de toasts |
| `<Toaster>` + `<ToastBar>` | `<ToastContainer>` con `<Portal>` de SolidJS (mount fuera del root DOM tree) |
| `react-hot-toast` reducer | signal-based queue: `[toasts, setToasts] = createSignal<Toast[]>([])` con helpers `add`, `update`, `dismiss`, `remove`, `pause`, `resume` |
| `notificationShared` slice | `src/notifications/history.ts` con createStore + tauri command `notification_history_load`, `notification_history_mark_read`, `notification_history_remove`, `notification_history_clear` |
| Bell icon + badge en toolbar | nuevo componente `<BellIcon />` en `src/components/Toolbar/BellIcon.tsx`, derivar `unreadCount` del store de history |
| `NotificationMenu` dropdown | `<HistoryDropdown />` en `src/components/Toolbar/HistoryDropdown.tsx` con `<Portal>` y backdrop click-to-close |
| `notification-history` ipc channels | tauri commands en `src-tauri/src/commands/notifications.rs` |
| `notifications-service-client` (Centrifuge) | NO portar — es feature de GK Cloud, no aplica a chajá local |
| `localNotificationIds` (Big Sur slowdown, etc.) | NO portar — son notificaciones específicas a GitKraken's update flow |

### 9.3 Migration path desde el placeholder actual

1. **Fase 1 — toasts**: implementar el toast store + `<ToastContainer>` con
   las 4 severities (INFO/SUCCESS/ERROR/LOADING) y los 3 timeouts (3s/5s/10s
   + Infinity).
2. **Fase 2 — reemplazar callers**: localizar `branchOps.dialogError` y
   `setError` en `src/components/Toolbar/index.tsx`. Reemplazar por
   `pushToast({ variant: "ERROR", title, content, telemetry })`. Borrar
   `.toolbar__error` y su CSS.
3. **Fase 3 — bell + history**: agregar `<BellIcon />` a la toolbar, store
   de history (signal map by id), tauri commands para persist.
4. **Fase 4 — opcional**: hookear los toasts a la history (cuando un toast
   ERROR/SUCCESS se dispara y la operación es "notable", también crear un
   history entry). En GitKraken NO se hace esto — son sistemas separados —
   pero para chajá puede ser deseable porque no hay cloud-pushed
   notifications que poblen la history por sí solas.

### 9.4 Severity mapping a chajá

Reusar exactamente:

```ts
type Severity = "info" | "success" | "warning" | "error" | "loading";
const TOAST_DURATION = {
  veryShort: 3_000,
  short: 5_000,
  default: 10_000,
  forever: Infinity,
};
```

Notar que GitKraken NO tiene `WARNING` como variant separada — usa `INFO`
con icono distinto cuando aplica, o `ERROR` con `dismissable: X_ONLY` para
errors recuperables. **Recomendación para chajá**: agregar `WARNING` (yellow,
icono triangle-exclamation) — la diferencia UX vale la pena aunque GK no la
haga.

### 9.5 Pattern para los callers Rust → Frontend

Backend (Rust) emite Tauri events tipados:

```rust
#[derive(Serialize)]
struct ToastEvent {
  variant: ToastVariant,    // enum serialized as uppercase string
  title: String,
  content: Option<String>,
  duration_ms: Option<u32>, // None = use default for variant
  buttons: Vec<ToastButton>,
  dismissable: ToastDismiss, // enum: True | False | XOnly
}

app.emit_all("toast::push", ToastEvent { ... })?;
```

Frontend escucha en un solo lugar (root, una vez):

```tsx
listen<ToastEvent>("toast::push", (e) => pushToast(e.payload));
```

Esto desacopla los call sites del backend del store del frontend, igual que
GitKraken usa Redux dispatch como capa intermedia.

## 10. Open questions

Cosas que requirieron grep y no encontré evidencia o requieren runtime
tracing para confirmar:

1. **Persistencia del `notificationsByIdMap`** — el slice está marcado en la
   cache definition (`/tmp/gk-bundle-pretty.js:60442`,
   `notificationShared: !0`) pero no encontré el código exacto del flush a
   disco. La hipótesis es que se persiste en el main process via Electron
   storage (los IPC channels lo sugieren), no en localStorage del renderer.
   Grep que probé:

   ```bash
   grep -n "notificationShared" /tmp/gk-bundle-pretty.js
   # solo 4 hits, todos en selectors/init/cache config
   ```

   Para chajá: definir explícitamente la persistencia (file path en
   `app_data_dir`).

2. **Capacity max del history** — no encontré ningún `slice(0, N)` ni LRU
   eviction sobre `notificationsByIdMap`. Hipótesis: GitKraken confía en que
   el server gestiona el envelope (probablemente cap server-side) y soft-
   deletes locales no se purgan. Para chajá: definir un cap explícito (sugiero
   500 entries con LRU por createdAt).

3. **Mute por categoría** — no existe en GitKraken. La única preferencia es
   `cloudSettings.marketing.enabled`. Toda otra categoría siempre se muestra.
   Grep que probé:

   ```bash
   grep -n "categories\|category\|mute\|silence" /tmp/gk-bundle-pretty.js \
     | grep -i "notif\|toast"
   # solo 1 hit en notifications-service-client (validación de payload)
   ```

   Para chajá: si querés mute por categoría, es feature original (no port).

4. **Sound on toast** — confirmado que NO existe. No hay `Audio()`,
   `play()`, ni samples bundled.
5. **Focus / accessibility on toast** — el toast root NO recibe focus
   programático. `react-hot-toast` setea `role: "status"` y `aria-live:
   "polite"` en el container — confirmado en
   `/tmp/gk-bundle-pretty.js:157090-157091`. El close button es solo
   clickeable, no foco-target (no `tabIndex`, no `<button>` real).
   Para chajá: mejor usar `<button>` real para a11y.
6. **Stacking direction de toasts** — `react-hot-toast` por default apila
   newest-on-top (`prepend` en el reducer line 156983). El container toma
   `position` de los settings. Edge case: con 20 toasts simultáneos, la UX
   colapsa. GitKraken no lo previene activamente (deja que la lib maneje el
   slice(0, 20)).
7. **Toast con avatar / image / progress** — no existen como features
   nativas. Si necesitás avatares (CI status del PR autor), tendrías que
   inyectarlos via el `content` ReactNode (que sí acepta JSX arbitrario).
8. **Behavior del action callback que falla** — el botón `onClick` no está
   wrapped en try/catch en el componente (`/tmp/gk-bundle-pretty.js:156131-
   156133`). Una excepción propagaría al React boundary del button. El
   `<ErrorBoundary>` del `toast-buttons` block (línea 156243) sí lo atrapa
   y reemplazaría el bloque por el fallback del boundary. **NO hay fallback
   default a "abrir en browser" si falla el callback** — chajá puede
   agregarlo.
9. **GitKraken usa dos niveles de telemetry diferentes**: cuando una toast
   `ERROR` tiene `telemetry.message`, registra `ERROR_TOAST_SHOWN` con el
   metric system new (`sendOnlyNewMetricSystem: !0`,
   `/tmp/gk-bundle-pretty.js:3186-3192`). chajá podría replicar esto
   apuntando al sistema de logs/audit de Tauri.
