import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

export function carpetaCaso(directory: string, caso: string): string {
  return path.join(directory, "fixtures", "reto-03", "solicitudes", caso)
}

export function carpetaMaestros(directory: string): string {
  return path.join(directory, "fixtures", "reto-03", "maestros")
}

export function carpetaSalida(directory: string, ...partes: string[]): string {
  return path.join(directory, "out", ...partes)
}

/** Crea la carpeta si no existe y devuelve la ruta. */
export function asegurarCarpeta(carpeta: string): string {
  mkdirSync(carpeta, { recursive: true })
  return carpeta
}

/** Lee un archivo de texto; devuelve null si no existe. */
export function leerTextoSiExiste(ruta: string): string | null {
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null
}

/** Ruta relativa a la raíz del proyecto con "/" para mostrarla igual en Windows y Linux. */
export function rutaRelativa(directory: string, ruta: string): string {
  return path.relative(directory, ruta).split(path.sep).join("/")
}

/** Un caso válido es solo un nombre de carpeta: evita rutas como "../". */
export function esNombreDeCasoValido(caso: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(caso)
}
