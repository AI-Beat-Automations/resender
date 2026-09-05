"use client"

import * as React from "react"

// Hueco de acciones del header de la consola (ADR 0015). Cada pantalla monta
// `<HeaderActions>` con sus botones y el header los pinta en `HeaderActionsSlot`.
// Es un contexto de React y no un portal por id: el header se renderiza antes
// que el contenido y un `document.getElementById` en el primer render no lo
// encontraría; con estado, el hueco se rellena en cuanto la pantalla monta.

type HeaderActionsContextValue = {
  actions: React.ReactNode
  setActions: (node: React.ReactNode) => void
}

const HeaderActionsContext =
  React.createContext<HeaderActionsContextValue | null>(null)

export function HeaderActionsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [actions, setActions] = React.useState<React.ReactNode>(null)
  const value = React.useMemo(() => ({ actions, setActions }), [actions])

  return (
    <HeaderActionsContext.Provider value={value}>
      {children}
    </HeaderActionsContext.Provider>
  )
}

function useHeaderActions(): HeaderActionsContextValue {
  const ctx = React.useContext(HeaderActionsContext)
  if (!ctx) throw new Error("HeaderActions fuera de <HeaderActionsProvider>")
  return ctx
}

/** La pantalla lo monta con sus botones; no renderiza nada in situ. */
export function HeaderActions({ children }: { children: React.ReactNode }) {
  const { setActions } = useHeaderActions()

  // Se limpia al desmontar para que la siguiente pantalla no herede los
  // botones de la anterior durante la navegación.
  React.useEffect(() => {
    setActions(children)
    return () => setActions(null)
  }, [children, setActions])

  return null
}

/** Lo renderiza el header, a la derecha del breadcrumb. */
export function HeaderActionsSlot() {
  const { actions } = useHeaderActions()
  if (!actions) return null
  return <div className="flex items-center gap-2">{actions}</div>
}
