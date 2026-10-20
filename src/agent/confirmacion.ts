const PALABRAS_DE_CONFIRMACION = ["si", "confirmo", "confirmado", "adelante", "procede", "ok", "dale"]

/** Minúsculas, sin tildes y solo palabras: "¡Sí, confirmo!" → ["si", "confirmo"]. */
function palabras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p !== "")
}

/** true si el mensaje contiene una palabra de confirmación y no contiene "no". */
export function esConfirmacion(mensaje: string): boolean {
  const lista = palabras(mensaje)
  if (lista.includes("no")) return false
  return lista.some((p) => PALABRAS_DE_CONFIRMACION.includes(p))
}
