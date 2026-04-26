# Smart Branch Visibility

GitKraken expone un toggle "Smart Branch Visibility" en el column-settings
popover del grafo. Cuando está ON, el grafo deja de mostrar todas las ramas
del repo y solo paga walk sobre un set reducido y "relevante al trabajo
actual". Este doc disecciona la implementación real, que **no** es un
heuristico de fecha tipo "stale > N días" sino un servicio Redux con un
algoritmo determinístico que construye el set permitido a partir del
HEAD branch, su upstream, la rama base detectada por reflog, la rama por
defecto del repo y, opcionalmente, la base branch del PR abierto contra
HEAD.

Bundle de referencia: `/tmp/gk-bundle-pretty.js` (GitKraken 12.0.1
beautified, 414128 líneas).

## Resumen ejecutivo

- Servicio singleton `SmartBranchesService` en `/tmp/gk-bundle-pretty.js`
  L184316-184422 (módulo minificado en este bundle ≠ 206684 del issue
  body, los IDs cambian; localizar siempre por nombre, no por id).
- El algoritmo central `resolveAllowedRefs` (L185603-185686) devuelve un
  diccionario `{ fullName: true, ... }` con como mucho **5 refs**: HEAD,
  upstream(HEAD), base branch detectada por reflog, base branch del PR
  abierto contra HEAD, y upstream(base branch) cuando la base es local.
- El servicio aplica ese set a través del repo setting `soloedRefs`
  (mismo mecanismo que el "Solo" manual). El grafo respeta solo eso —
  no hay rama "Smart Branches"-específica en el state tree, todo se
  multiplexa por `soloedRefs` + flag `smartBranchesManaged`.
- Detached HEAD (`headRefFullName === "HEAD"`), repo sin HEAD, repo no
  cargado, o `enabled === false` salen temprano con cleanup. Nunca
  crashea.
- No hay set "recently checked out" cargado del reflog HEAD en runtime;
  lo único que se lee del reflog es el snippet `branch: Created from |
  branch: Reset to | reset: moving to` para detectar la base branch
  histórica de la rama actual (con cache en memoria invalidado por
  `mtime` de `logs/HEAD`).

## `SmartBranchesService` class

`/tmp/gk-bundle-pretty.js:184316-184422` (módulo emisor con `id =
57590`-vecino, exportado vía factory `getSmartBranchesService` desde
`145482`).

Propiedades de instancia:

- `isService = true` — marker para el service registry.
- `appliedState: { repoPath, headRefFullName, soloedRefs, soloedRemotes
  } | null` — última foto aplicada; usada para diff incremental.
- `syncRequestVersion: number` — contador monotónico de "hay un sync
  pendiente".
- `syncInFlight: Promise | null` — promesa del drain actual, si lo hay.

Métodos públicos:

- `constructor()` (L184340) — se suscribe a `getSmartBranchesReduxData`
  vía `subscribeToStateChange`; cualquier cambio en el slice dispara
  `requestSync()` si `enabled || smartBranchesManaged`. También llama
  `requestSync()` una vez al construirse.
- `setEnabled(Ve, at, ct, hn)` (L184347) — entra desde la UI con
  `(null, boolean, SmartBranchesContexts.*, ?suppressUnmanage)`.
  - Registra una métrica `metrics.SETTING` con
    `setting: BRANCH_VISIBILITY` y `value: "smart" | "all"`.
  - Si `at === false` y `hn === true`: solo apaga
    `smartBranchesManaged` (deja `soloedRefs` intactos — esto es lo
    que dispara `MANUAL_OVERRIDE` cuando el usuario toca solo a mano).
  - Si `at === false` y `hn !== true`: limpia el estado vía
    `clearSoloStateForRepoPath` (resetea `smartBranchesManaged`,
    `soloedRemotes`, `soloedRefs`).
  - Siempre persiste el toggle en el profile setting de path
    `["ui", "graphOptions", "smartBranches"]` (cte
    `SMART_BRANCHES_SETTING_PATH` en L180992 — es **profile-wide**, no
    per-repo).
- `requestSync()` (L184364) — incrementa version y arranca el drain
  loop si no hay uno corriendo.
- `drainSyncQueue()` (L184369) — corre `syncInternal` hasta que la
  versión deja de cambiar entre iteraciones (coalesce de cambios
  rápidos).
- `syncInternal(Ve)` (L184378) — el corazón del lifecycle. Ver sección
  siguiente.
- `clearSoloStateForRepoPath(Ve, at, ct)` (L184321) — pone a `false`
  `smartBranchesManaged`, vacía `soloedRemotes` y `soloedRefs`, dispara
  `refreshCommits({blocking, callSource})`.
- `applySoloStateForRepoPath(Ve, at, ct, dt)` (L184328) — pone
  `smartBranchesManaged = true` (si no lo está), vacía
  `soloedRemotes` solo si había alguno, escribe `soloedRefs = ct`,
  dispara `refreshCommits`.

Dependencias importadas (L184303-184313):

- `dt = ct(46042)` — store wrappers (`getState`, `subscribeToStateChange`).
- `ln = ct(66820)` — profile settings (`setCurrentProfileSetting`).
- `dn = ct(3578)` — repo settings actions (`setRepoSetting`).
- `hn = ct(25354)` — `refreshCommits`.
- `mn = ct(33553)` — `callOrDispatch`.
- `gn = ct(49248)` — `resolveAllowedRefs` (mismo módulo desde
  `/tmp/gk-bundle-pretty.js:185598`).
- `Rn = ct(57590)` — selector `getSmartBranchesReduxData`.
- `Fn = ct(45151)` — `metrics`, `SmartBranchesContexts`.

## `syncInternal` — lifecycle

Ubicación: `/tmp/gk-bundle-pretty.js:184378-184421`.

Pasos (con names minificados anotados):

1. Lee snapshot Redux: `at = getSmartBranchesReduxData(getState())`.
   Destructura `enabled`, `explicitlySoloedRefs`, `explicitlySoloedRemotes`,
   `headRefFullName`, `isCheckingOutBranch`, `repo`, `repoPath`,
   `smartBranchesManaged`.
2. Si `appliedState.repoPath !== repoPath`: descarta `appliedState`.
   El service es singleton cross-repo y reinicia su diff cada vez que
   cambia el repo activo.
3. Early-out con limpieza si `!enabled || !headRefFullName || !repo`.
   Cuando se sale por `!enabled` y todavía está `smartBranchesManaged`,
   llama `clearSoloStateForRepoPath` con `callSource =
   "SmartBranchesService.staleCleanup"`. Esto cubre detached HEAD
   (`headRefFullName === "HEAD"` no entra acá; se filtra después por
   `resolveAllowedRefs` que usa `headRefFullName` como key).

   > Nota: `headRefFullName` viene del slice de refs. Cuando el repo está
   > en detached HEAD, el selector retorna `"HEAD"` (no `null`); el caso
   > `null` ocurre solo si el repo aún no terminó de cargar. Ambos casos
   > pasan a través del check `!headRefFullName`. La cadena `"HEAD"` es
   > truthy, así que detached **no** corta acá; corta dentro de
   > `resolveAllowedRefs` cuando `Fn["HEAD"]` es undefined.

4. **Detección de override manual**. Si hay `appliedState`:
   - `Ve = appliedState.headRefFullName !== headRefFullName` — ¿cambió HEAD?
   - `dt = sortedEqual(appliedState.soloedRefs, sorted(explicitlySoloedRefs))`
     — ¿el `soloedRefs` del repo setting es el mismo que aplicamos?
   - `gn = sortedEqual(appliedState.soloedRemotes, sorted(explicitlySoloedRemotes))`
     — idem para remotes.
   - Si **ninguna** de estas condiciones se cumple: `isCheckingOutBranch
     || cambioHead || (refsIguales && remotesIguales)` → significa que
     el usuario tocó manualmente el solo set. Se dispara
     `setEnabled(null, false, MANUAL_OVERRIDE, true)` que apaga
     `smartBranchesManaged` pero deja `soloedRefs` como están (el
     usuario quiere ese set). Return.
5. Computa el set permitido: `zn = await resolveAllowedRefs(null, at)`.
6. Si la versión cambió mientras esperábamos: return (otro sync vendrá).
7. `$n = sortedKeys(zn)`; si está vacío: return (defensivo, no aplica
   nada).
8. Si `appliedState.soloedRefs == $n` ya: return (no-op).
9. Compara con `explicitlySoloedRefs`:
   - `er = sorted(explicitlySoloedRefs)`.
   - `lr = (explicitlySoloedRemotes?.length ?? 0) > 0`.
   - Si el set computed difiere del actual del repo, **o** hay
     soloedRemotes a limpiar: dispara `applySoloStateForRepoPath(null,
     repoPath, $n, {smartBranchesManaged, hasSoloedRemotes: lr,
     callSource: "SmartBranchesService.sync"})`.
10. Actualiza `appliedState` con `{repoPath, headRefFullName,
    soloedRefs: $n, soloedRemotes: []}` en cualquiera de las dos ramas
    finales.

## `resolveAllowedRefs` algorithm

`/tmp/gk-bundle-pretty.js:185603-185686`. Función exportada del módulo
`49248`. Es **pura** salvo por el `callOrDispatch` para
`getRepositoryDefaultBranchFullName` y la lectura de reflog HEAD.

### Inputs (shape de `at` = `getSmartBranchesReduxData(state)`)

```ts
interface SmartBranchesReduxData {
  enabled: boolean;
  headRefFullName: string | null;        // p.ej. "refs/heads/feature/x" o "HEAD"
  shownRefsByFullName: Record<string, RefModel>;
  upstreamRefsByDownstreamRefs: Record<string, string>;  // local → upstream remote fullName
  explicitlySoloedRefs: string[];        // soloedRefs del repo setting
  explicitlySoloedRemotes: string[];     // soloedRemotes del repo setting
  isCheckingOutBranch: boolean;
  smartBranchesManaged: boolean;         // del repo setting (no del profile)
  prBaseBranchName: string | null;       // pr.base.name (corto, no fullName)
  repoPath: string | null;
  repo: NodeGitRepoHandle | null;
}
```

`RefModel` (proyectado por `getShownRefsByFullName`, fuente
`/tmp/gk-bundle-pretty.js:114819`) trae al menos `{type:
"branch"|"remote"|"tag"|"annotatedTag", name: string, remoteName?:
string, sha: string, isHidden: boolean, ...}`.

### Pseudo-código

`Fn = shownRefsByFullName`, `dt = headRefFullName`, `Zr =
upstreamRefsByDownstreamRefs ?? {}`, `Xr = Zr[dt]` (upstream del
HEAD), `ta = Xr ? Fn[Xr]?.remoteName : null` (nombre del remote del
upstream).

1. **Reflog cache + lookup de base branch del HEAD** (L185613-185635):
   - Cache key `${repoPath}::${headRefFullName}` en un `Map` global
     (`Dn`, L185694).
   - Lee `mtime` de `${repoPath}/logs/HEAD`. Si la entrada cacheada
     tiene el mismo `mtime` (o el mtime es `null` por error de stat):
     reusa el valor cacheado y se salta la llamada a git.
   - Si no, llama `gkGit.getBranchBaseFromReflog(globalGitOptions,
     headRefFullName)` (definido en L292361-292383). Esa función:
     - corre `git log <head> --walk-reflogs --format=%gs --grep-reflog
       "^branch: Created from |^branch: Reset to |^reset: moving to "
       -z`, parsea con `parseBranchCreatedFromResetToReflog` (regex
       `^branch: Created from (.*)|^branch: Reset to (.*)$`,
       L148117) y `parseResetMovingToReflog` (regex `^reset: moving
       to (.*)$`, L148119). Si hubo un `reset: moving to`: retorna
       `null` (no es base branch detectable).
     - Si la match es `"HEAD"`: corre un segundo `git log HEAD
       --walk-reflogs --format=%gs --grep-reflog "^checkout: moving
       from .* to <shorthand>$"` y parsea con
       `parseCheckoutMovingFromReflog` (regex `^checkout: moving
       from (.*) to (.*)$`, L148118). Toma el último match.
     - El resultado pasa por `resolveBaseRef` (L292033-292041) que
       resuelve la upstream del nombre crudo y devuelve
       `{confidence: Medium, ref: <upstreamFullName ?? localFullName>}`.
     - Solo el campo `.ref` se guarda en cache (`gr` = ese fullName, o
       `null`).
2. **Default branch del repo** (L185630): en paralelo se computa
   `Vr = await getRepositoryDefaultBranchFullName(globalGitOptions)`.
   Saga en `/tmp/gk-bundle-pretty.js:217414-217442`. Resolución
   ordenada:
   1. `defaultRef` del remote `"origin"` (o el primer remote).
   2. `init.defaultBranch` del profile setting → si la ref existe.
   3. `git config init.defaultBranch` → si la ref existe.
   4. Probar `refs/heads/master` y `refs/heads/main`; preferir `main`
      si existe, si no `master`, si tampoco existe `main` (siempre cae
      a `main` aunque no exista — caso degenerado).
3. **Resolver PR base** (L185640-185645): si `prBaseBranchName` (`zn`)
   no es null: `na = resolveNameToFullRef(Fn, zn, ta) ?? null`. La
   función `resolveNameToFullRef` (L185695-185714) busca primero
   `refs/remotes/<name>` exacto, después escanea `Fn` por `name === at`
   prefiriendo type === remote con `remoteName === ta`, después
   cualquier remote, después branch local.
4. **Fallback PR-base ← reflog base** (L185642-185645): si no hubo PR
   base pero sí `gr` del reflog **y** `gr` es type `"remote"` o
   `"branch"`: `na = gr`.
5. **Anti-self** (L185646): si `na === headRefFullName`: `na = null`
   (no incluyas HEAD como su propia base).
6. **Resolver default branch ref** (L185647-185657): IIFE que dado
   `Vr` (default branch fullName) intenta encontrar el remote-equivalente:
   - Si `Fn[Vr]` es type remote o branch: usa `Vr` directo.
   - Si no, normaliza el shorthand quitando prefix `refs/remotes/` o
     `refs/heads/`, prueba `refs/remotes/<short>` con `Fn[...]` type
     remote.
   - Si todavía no, cae a `resolveNameToFullRef(Fn, short, ta)`.
   - Asignado a `aa`.
7. **Construcción del set** (L185658-185684):
   ```
   sa = {}
   includeRef(sa, Fn, dt)                     // HEAD
   includeUpstream(sa, Fn, Zr, dt)            // upstream(HEAD)
   if na:
     v = Fn[na]
     if v.type == "remote": includeRef(sa, Fn, na)
     elif v.type == "branch":
       includeRef(sa, Fn, na)
       includeUpstream(sa, Fn, Zr, na)
     return sa                                 // PR base WINS sobre default
   if aa:
     v = Fn[aa]
     if v.type == "remote":
       includeRef(sa, Fn, aa)
       // además, todos los downstream locales que apuntan a este remote:
       downstreamsByUpstream = invert(Zr)
       for d in (downstreamsByUpstream[aa] ?? []):
         includeRef(sa, Fn, d)
     elif v.type == "branch":
       includeRef(sa, Fn, aa)
       includeUpstream(sa, Fn, Zr, aa)
   return sa
   ```
   - `includeRef(sa, Fn, fullName)` (L185716): no-op si `fullName`
     falsy o si `Fn[fullName].type` no es `branch`/`remote`. Setea
     `sa[fullName] = true`.
   - `includeUpstream(sa, Fn, Zr, fullName)` (L185721): solo llama
     `includeRef(sa, Fn, Zr[fullName])`. Si `fullName` no tiene
     upstream o el upstream ya no existe en `Fn`: silently no-op.

### Tipos de ref permitidos

Solo se incluyen refs `type === "branch"` o `type === "remote"`.
**Tags y annotatedTags se filtran por `includeRef`**: aunque `gr`,
`aa` o `na` apunten a un fullName tipo tag, el guard de `includeRef`
los descarta. **Stash refs no aparecen en `shownRefsByFullName`** (no
se exponen como ref normal — se manejan en su propio slice; los
selectors `getRefsTree` y `getShownRefsByFullName` filtran por
`["branch","remote","tag","annotatedTag"]` en general, pero
`includeRef` recorta a branch+remote para soloing).

## Redux data shape — selector

`/tmp/gk-bundle-pretty.js:221099-221114` (`getSmartBranchesReduxData`,
módulo `57590`).

Composición (orden de los inputs del `createSelector`):

| # | Selector | Fuente |
|---|---|---|
| 1 | `getSmartBranchesEnabled` | `/tmp/gk-bundle-pretty.js:189148`. Lee el profile setting `["ui","graphOptions","smartBranches"]`. **Profile-wide** (no per-repo). |
| 2 | `getHeadRefName` | refs slice; retorna `"refs/heads/<x>"` o `"HEAD"` (detached) o `null` (no cargado). |
| 3 | `getShownRefsByFullName` | L114819. `pickBy(!isHidden)` sobre el ref slice. |
| 4 | `getUpstreamFullNamesByDownstreamFullName` | L114649. `state.ref.upstreamFullNamesByDownstreamFullName`. |
| 5 | `getExplicitlySoloedRefs` | L114753. `repoSettings.soloedRefs`. |
| 6 | `getSoloedRemotes` | L49517. `repoSettings.soloedRemotes ?? []`. |
| 7 | `getIsCheckingOutBranch` | L114904. `!isEmpty(refCurrentlyBeingCheckedOut)`. |
| 8 | `getRepoSettings` | repo slice principal. Solo se usa `.smartBranchesManaged`. |
| 9 | `getPullRequestForHeadRef` | L114867. Devuelve un PR cuyo `head.sha === HEAD.sha`. |
| 10 | `getPullRequestsForHeadRef` | L114743. Lista (fallback `[0]`). |
| 11 | `getRepoPath` | path absoluto. |
| 12 | `getRepo` | handle nodegit del repo. |

Output (los nombres minificados Ve..Dn corresponden 1:1 a la lista de
arriba, ver L221099):

```ts
{
  enabled: Boolean(Ve),                          // profile setting
  headRefFullName: at,
  shownRefsByFullName: ct,
  upstreamRefsByDownstreamRefs: dt,
  explicitlySoloedRefs: ln,
  explicitlySoloedRemotes: dn,                   // viene de getSoloedRemotes
  isCheckingOutBranch: hn,
  smartBranchesManaged: Boolean(mn?.smartBranchesManaged),
  prBaseBranchName: (gn ?? Rn[0])?.base?.name ?? null,
  repoPath: An,
  repo: Dn,
}
```

> Observación: la key se llama `explicitlySoloedRemotes` aunque el
> selector de origen es `getSoloedRemotes` (no `getExplicitlySoloed*`).
> No hay distinción real entre "soloed" y "explicitly soloed" para
> remotes en este código.

## Toggle / enable lifecycle

- **Persistencia del toggle**: profile setting
  `["ui","graphOptions","smartBranches"]`
  (`SMART_BRANCHES_SETTING_PATH` en L180992). Es **profile-wide**: el
  toggle no es per-repo.
- **Quién dispara `setEnabled`**:
  - `LEFT_PANEL` (L48527) — botón "disable smart branches" en el panel
    izquierdo, siempre apaga.
  - `GRAPH` (L303210) — popover de column-settings del grafo, toggle
    binario.
  - `UI_CUSTOMIZATION` (L346241) — pantalla Preferences > UI
    Customization, toggle binario.
  - `ANNOTATION` (L124673) — link "Show all branches" del banner que
    se muestra cuando se auto-habilitó.
  - `AUTO_ENABLE` (L202251) — saga
    `evaluateSmartBranchVisibilityAutoEnable` (L202235-202256), AB
    test feature `gkdAutoSmartBranchVisibility`. Solo se evalúa una
    vez por usuario (milestone
    `smartBranchVisibilityAutoEvaluated`), solo si `repoCommits > 6`,
    solo si "normal client" y no en tutorial repo. Si el usuario está
    en cohorte test, llama
    `setEnabled(null, true, AUTO_ENABLE)` y emite
    `EventName.SMART_BRANCH_VISIBILITY_AUTO_ENABLED`.
  - `MANUAL_OVERRIDE` (L184397, generado dentro del propio
    `syncInternal`) — el usuario tocó solo a mano mientras Smart
    Branches estaba ON. Llama
    `setEnabled(null, false, MANUAL_OVERRIDE, true)` con el cuarto
    flag `hn = true`, lo que apaga `smartBranchesManaged` pero
    **preserva los `soloedRefs` actuales**.
- **`smartBranchesManaged`**: bool en `repoSettings`, **per-repo**.
  Significa "el `soloedRefs` del repo fue puesto por
  SmartBranchesService, no por el usuario". Sirve para distinguir un
  refresh estándar (aplicar Smart) vs un override manual (apagar Smart
  sin tirar el solo set). Default off al abrir un repo nuevo. Se pone
  ON dentro de `applySoloStateForRepoPath` (L184334) y OFF dentro de
  `clearSoloStateForRepoPath` (L184322), `setEnabled(off,
  preservaSolo=true)` (L184360), o cuando se detecta override manual.

## Edge cases (confirmados contra el bundle)

| Input | Comportamiento |
|---|---|
| Single-branch repo (solo HEAD, sin upstream, sin remotes, sin reflog útil) | `sa = {[HEAD]: true}`. `aa` cae al fallback `main`/`master`; si `Fn["refs/heads/main"]` no existe, `includeRef` no hace nada. Resultado: 1 ref. (L185660-185684, `includeRef` guard L185716) |
| HEAD + upstream | `sa = {HEAD, upstream(HEAD)}`. `includeRef` + `includeUpstream` (L185660). Si el upstream además es la default branch (raro), no se duplica porque es un objeto. |
| HEAD con merges recientes desde feature/X | **NO se incluye `feature/X`**. El algoritmo no consulta merge-base, descendant-of ni reflog de feature/X. Lo que sí puede pasar: si el reflog de HEAD muestra "branch: Created from feature/X" y feature/X sigue existiendo, `gr = upstream(feature/X) ?? feature/X` y feature/X termina como `na` (PR-base fallback) — pero solo si **no hay PR abierto contra HEAD** (el PR base le gana, L185641). |
| Branches stale sin merge relation | Filtradas. No hay paso de "incluir todas las branches con commits recientes" — el set tope es 5 refs. |
| Tags | Nunca incluidas. `includeRef` exige `type ∈ {"branch","remote"}` (L185719). |
| Annotated tags | Idem, nunca incluidas. |
| Stash refs | No aparecen en `shownRefsByFullName` (L114911 filtra a `branch/remote/tag/annotatedTag`); además `includeRef` los rechazaría. El soloing es ortogonal al stash slice. |
| Detached HEAD (`headRefFullName === "HEAD"`) | `Fn["HEAD"]` no existe (no hay un `RefModel` con fullName literal `"HEAD"`), por lo tanto `includeRef` y `includeUpstream` son no-op para ese fullName. `Zr["HEAD"]` tampoco existe. El fallback de `aa` (default branch) sí puede incluir `main`/`master`. Resultado típico: `sa = {default_branch}` o `{}`. Si `{}`, `syncInternal` retorna en L184402 sin aplicar nada → el grafo queda en su estado previo. |
| HEAD null (repo todavía cargando) | `syncInternal` retorna en L184390 (`!headRefFullName`). |
| HEAD sin upstream | `Zr[head] === undefined`. `includeUpstream` no-op. `ta` (remote name del upstream del head) es `null`, lo cual afecta al tie-break de `resolveNameToFullRef` pero no causa crash. |
| `explicitlySoloedRefs` ya iguala el computado | L184403 short-circuit, no se aplica. |
| `explicitlySoloedRefs` distinto y `smartBranchesManaged === false` | Detectado como override manual en L184397, se llama `setEnabled(off, MANUAL_OVERRIDE, preserveSolo=true)`. |
| `smartBranchesManaged === false` y arranca sin appliedState | El bloque de override (L184391) está condicionado a `appliedState`. La primera vez que entra, `appliedState === null`, entonces se salta el guard y aplica el set computed (overwriting cualquier solo manual previo). **Esto significa que activar Smart Branches PISA cualquier solo manual existente sin preguntar**. |
| Fetch en curso / `isCheckingOutBranch === true` | El override manual no dispara aunque diff (L184397: `if (mn || Ve || dt && gn)` continúa al apply path). Es decir, durante un checkout no se interpreta el cambio de `soloedRefs` como override del usuario. |

## `explicitlySoloedRefs` — additive vs override

**Override total**, no additive. `applySoloStateForRepoPath` (L184334)
escribe `soloedRefs = ct` (el set computed por
`resolveAllowedRefs`), no merge con el previo. Si el usuario tenía un
solo manual `[refs/heads/feature/y]` y activa Smart Branches, queda
`soloedRefs = [HEAD, upstream, base...]` — `feature/y` desaparece.

Cuando Smart Branches **se apaga** vía `MANUAL_OVERRIDE` (el usuario
tocó solo a mano mientras Smart estaba ON), el set actual del usuario
se preserva (L184397 con `hn=true`, L184360 que toma el path
`smartBranchesManaged=false` sin clear).

## Interaction con otros filtros

### vs author filter / search

Smart Branches y los filtros de commit son ortogonales y se aplican
en capas distintas.

- **Smart Branches** opera sobre `soloedRefs` → `shownRefs` →
  `getRefsForRevWalkByFullName` (L114897): `isSoloing ?
  soloedRefsByFullName : shownRefsByFullName`. O sea, decide qué
  refs entran al rev-walk inicial; reduce el universo de commits que
  se cargan del libgit2/git CLI.
- **Author filter / search** opera sobre los commits ya cargados,
  vía `searchMode: "filter"|"normal"` y `highlightedShas` (mapa sha
  → bool). Ver `isCommitListFiltered()` (L405540): retorna
  `searchMode === "filter" && Object.values(highlightedShas).length >
  0`. Cuando `isCommitListFiltered()` es true, `loadEdgesBySha`
  (L404980) hace short-circuit y **no procesa edges**:
  ```js
  loadEdgesBySha() {
    this.maxColumns = 0;
    this.isCommitListFiltered() || this.orderedGraphRows.forEach(...)
  }
  ```

  Esto explica el bug de #155: cuando author filter está ON, el grafo
  pierde toda su estructura de edges (no es solo una atenuación
  visual, es un short-circuit del cómputo). Smart Branches **no
  amplifica ni mitiga** esto — Smart afecta el rev-walk (commits
  cargados), filter afecta el render de aristas. Si los dos están
  ON, el grafo: (a) carga menos commits (Smart), (b) no dibuja edges
  entre los que carga (filter).

### vs hidden refs

`getShownRefsByFullName` (L114819) excluye refs marcadas como hidden.
Smart Branches recibe ese set ya filtrado → si el usuario ocultó
`refs/heads/main` manualmente, Smart no lo va a poder incluir aunque
sea la default branch (porque `Fn[main]` no existe en el subset
mostrado).

### vs hidden remotes

`getSoloedRemotes` y `getHiddenRemotes` viven en otro slice. Smart
Branches **vacía** `soloedRemotes` cada vez que aplica un set
(`applySoloStateForRepoPath` con `gn = true` cuando había alguno;
L184334). Es decir, activar Smart limpia cualquier "solo this remote"
manual previo.

## Implementation guidance para chajá

### Backend Rust

Lo que el actual proxy "stale > 90 días" no cubre y se necesita:

- **Lectura de reflog HEAD del repo activo** con dos queries:
  1. `git log <head> --walk-reflogs --format=%gs --grep-reflog "^branch:
     Created from |^branch: Reset to |^reset: moving to "` (con `-z`).
     Parser que extraiga la primera línea matcheada de `branch: Created
     from <X>` o `branch: Reset to <X>`. Si hay un `reset: moving to`,
     **abortar** (señal de reset deliberado, no usable como base).
  2. Si la match es `"HEAD"`: segunda query `git log HEAD
     --walk-reflogs --format=%gs --grep-reflog "^checkout: moving from
     .* to <shorthand>$"`, tomar la **última** match.
  - Cache en memoria con key `(repoPath, headFullName)` invalidado
    por `mtime` de `<gitdir>/logs/HEAD`.
- **Resolución de upstream** de un branch dado: equivalente a `git
  rev-parse --symbolic-full-name <branch>@{upstream}` y, para
  refs/heads: `git for-each-ref --format=%(upstream) <fullName>`.
  Devolver el upstream fullName (`refs/remotes/<remote>/<branch>`) o
  `None`.
- **Default branch del repo** (ya implementado parcialmente en
  chajá; verificar). Orden:
  1. Configuración del remote `origin`/primer remote: `git
     symbolic-ref refs/remotes/origin/HEAD --short` o cache del
     refresh de remotes.
  2. Profile setting `init.defaultBranch` si la ref existe.
  3. `git config init.defaultBranch` si la ref existe.
  4. Probar `refs/heads/main` y `refs/heads/master`. Preferir `main`.
- **Inversión de upstreams** (`downstreamsByUpstream`): cuando la
  default branch resuelve a un remote, hay que enumerar todos los
  branches locales que tienen ese remote como upstream. Se puede
  precomputar de `upstreamRefsByDownstreamRefs` (que el frontend ya
  mantiene).
- **NO se necesita** un "graph_descendant_of" ni "merge_base" para
  Smart Branches. El algoritmo no usa relaciones de grafo. Lo único
  "histórico" es el reflog parsing.

### Frontend SolidJS

- **Renombrar** `staleRefs` → `hiddenBySmartFilter` (o similar) — el
  proxy actual está semánticamente desalineado.
- **Resource pattern**: el toggle debería disparar un side-effect que
  recompute el set permitido (con Suspense/transition), no un filtro
  reactivo derivado de fechas.
- **Estado del toggle**: profile-wide, no per-repo (alinear con
  GitKraken). El "managed" flag sí va per-repo en el repo settings
  slice.
- **`appliedState` cache**: replicar el objeto
  `{repoPath, headFullName, soloedRefs, soloedRemotes}` en el frontend
  para detectar overrides manuales. Si el usuario toca solo a mano,
  apagar Smart Branches pero **preservar el solo actual**.
- **Auto-enable**: opcional para chajá. GK lo gobierna por AB-test +
  feature flag + milestone "ya evaluado".
- **Composición con filter**: aplicar Smart en la capa de
  rev-walk/loader, y respetar que el author filter/search corren sobre
  los commits ya cargados. **No** mezclar los dos en un único pipeline.

## Open questions

- **Selector de `pull request` por `head.sha`**: confirmé
  `getPullRequestForHeadRef` (L114867) pero no rastreé el origen del
  slice de PRs (probablemente saga `refreshPullRequests`). Para chajá,
  si no hay integración GitHub/GitLab, `prBaseBranchName` es siempre
  `null` y el algoritmo cae al reflog → default branch.
- **Comportamiento exacto de `isCheckingOutBranch === true`**: por
  inspección de L184397, durante un checkout el override manual no se
  activa, pero no validé si los `requestSync()` se siguen disparando
  (probablemente sí — el subscribe no filtra por
  `isCheckingOutBranch`). Tracing en runtime sería más definitivo.
  Probé `grep -n "isCheckingOutBranch" /tmp/gk-bundle-pretty.js` y los
  hits son selectors + el destructuring del syncInternal; no encontré
  ningún `if (isCheckingOutBranch) skip`.
- **Si `Vr` (default branch) es `null`**: la saga
  `getRepositoryDefaultBranchFullName` siempre devuelve algo (cae a
  `refs/heads/main` en el peor caso). Pero si ese fullName no existe
  en el repo, `Fn[Vr]` será `undefined`, el IIFE de `aa` (L185647)
  llegará al `resolveNameToFullRef` y probablemente devuelva `null`.
  Resultado: `aa = null`, no se incluye nada por ese path. Confirmar
  con `if(aa)` en L185664. **Resultado**: confirmado, el bloque está
  guardeado con `if(aa)`.
- **`prBaseBranchName` cuando hay múltiples PRs por HEAD**: el
  selector toma `getPullRequestForHeadRef` que prefiere el PR cuyo
  `head.sha === headSha` (L114867-114877). Si hay varios, toma el
  primero del map. Para chajá puede no ser relevante de entrada.
- **Cache del reflog cross-repo**: el `Map` global `Dn` (L185694) no
  tiene LRU ni TTL — crece sin límite con cada `repoPath::head`
  visitado. Tal vez bug menor en GK. En chajá vale la pena un LRU
  pequeño (16-32 entradas).

## Discrepancias con el plan original del issue

1. **Issue cita módulo `206684`**. En este bundle (12.0.1), el
   módulo del service tiene una factory en `145482`
   (`getSmartBranchesService`) y la clase en
   `/tmp/gk-bundle-pretty.js:184316` (módulo de id distinto). Los
   numeric IDs del bundler **no son estables**; siempre buscar por
   nombre exportado.
2. **El issue dice "ramas con merge relation con HEAD"**. **No** hay
   cómputo de merge-base ni descendant-of. La inclusión de "feature
   branches mergeadas" es accidental, vía:
   - PR base si hay un PR abierto **contra** HEAD (caso típico:
     trabajás en `feature/x`, hay un PR `feature/x → main`, entra
     `main` como base, no `feature/x`).
   - Reflog `branch: Created from <feature/x>` si HEAD fue creado
     directamente desde feature/x (caso raro en el día a día).
3. **El issue body insinúa "recently checked-out branches"**. **No
   existe** ese concepto en el algoritmo. Solo se lee el `mtime` de
   `logs/HEAD` para invalidar cache, no para enumerar ramas
   recientes.
4. **El plan menciona TTL/límite de "recent set"**. No aplica — no
   hay set de "recent". El cap es estructural: máximo 5 refs
   (HEAD, upstream(HEAD), PR-base, default-branch, upstream(default
   o PR-base)), no temporal.
5. **`explicitlySoloedRefs` como additive con el computed**. Es
   **override total**. Activar Smart Branches pisa cualquier solo
   manual previo. La preservación solo ocurre al **apagar** Smart
   por override manual.
6. **Detached HEAD**: el plan asume que cae con grace mostrando
   "todas las branches". Lo que pasa en realidad: el set computed
   queda en `{default_branch}` o `{}`, y si es `{}` el sync hace
   short-circuit (L184402) sin aplicar — el grafo queda con lo que
   estaba antes (puede ser inconsistente si el usuario llegó a
   detached desde un estado con Smart aplicado). Vale la pena que
   chajá explícitamente desactive Smart en detached (cleanup
   explícito) en lugar del no-op silencioso de GK.
