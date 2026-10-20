import { appendFileSync, existsSync } from "node:fs"
import path from "node:path"
import { asegurarCarpeta, carpetaSalida } from "./rutas.ts"

/** Inicio del error de oc_crear cuando faltan confirmaciones; el ciclo del agente lo usa para detectar ese estado. */
export const MENSAJE_PENDIENTE_CONFIRMACION = "OC no creada, requiere confirmación del usuario"

export type ResultadoControl = "creada" | "bloqueada" | "pendiente_confirmacion" | "idempotente"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

type EntradaLog = { herramienta: string; caso: string; ok: boolean; resumen: string }

const COLUMNAS_CONTROL = ["solicitud_id", "resultado", "numero_oc", "retroactiva", "bloqueos", "confirmaciones", "ts"]

function rutaSalida(directory: string, archivo: string): string {
  return path.join(asegurarCarpeta(carpetaSalida(directory)), archivo)
}

/** Agrega una línea a out/log.jsonl (CA4). */
export function registrarLlamada(directory: string, entrada: EntradaLog): void {
  const linea = { ts: new Date().toISOString(), ...entrada }
  appendFileSync(rutaSalida(directory, "log.jsonl"), JSON.stringify(linea) + "\n", "utf8")
}

/** Encierra en comillas si el valor tiene coma, comillas o salto de línea. */
function celdaCsv(valor: string): string {
  return /[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

/** Agrega una fila a out/control.csv (HU-5). Escribe el encabezado la primera vez. */
export function registrarControl(directory: string, fila: FilaControl): void {
  const ruta = rutaSalida(directory, "control.csv")
  if (!existsSync(ruta)) appendFileSync(ruta, COLUMNAS_CONTROL.join(",") + "\n", "utf8")
  const celdas = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc,
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    new Date().toISOString(),
  ]
  appendFileSync(ruta, celdas.map(celdaCsv).join(",") + "\n", "utf8")
}
