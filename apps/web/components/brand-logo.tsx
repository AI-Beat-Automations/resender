// Logotipo de marca (símbolo + «Resender.dev») en dos versiones, negra y
// blanca, que se alternan con el tema: la negra se ve en claro y la blanca en
// oscuro. Son dos `<img>` y no un `<picture>` con `prefers-color-scheme` porque
// el tema NO sigue al sistema (ver theme-provider.tsx): lo decide la clase
// `.dark` del `<html>`, y eso solo lo lee CSS vía la variante `dark:`.
//
// `<img>` nativa a propósito: los PNG viven en `public/brand`, no necesitan
// optimización en Workers y `next/image` sumaría un loader por nada. Los dos
// archivos no miden lo mismo (600×126 y 600×136), así que se fija la altura y el
// ancho queda automático.
export function BrandLogo({
  className,
  height = 24,
}: {
  className?: string
  height?: number
}) {
  return (
    <span className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático en public/, sin optimizador */}
      <img
        src="/brand/resender-logo-black.png"
        alt=""
        height={height}
        style={{ height }}
        className="block w-auto dark:hidden"
        draggable={false}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático en public/, sin optimizador */}
      <img
        src="/brand/resender-logo-white.png"
        alt=""
        height={height}
        style={{ height }}
        className="hidden w-auto dark:block"
        draggable={false}
      />
    </span>
  )
}
