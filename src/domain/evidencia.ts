import { createHash } from "node:crypto"
import path from "node:path"
import { AprobacionArchivoSchema } from "./esquemas.ts"
import type { AprobacionArchivo } from "./esquemas.ts"
import { parsearJson } from "./paquete.ts"
import { carpetaCaso, leerTextoSiExiste } from "./rutas.ts"

export type Evidencia = { contenido: string; sha256: string }

function leerAprobacion(directory: string, caso: string): AprobacionArchivo {
  const texto = leerTextoSiExiste(path.join(carpetaCaso(directory, caso), "aprobacion.json"))
  if (texto === null) throw new Error("Falta aprobacion.json: no hay evidencia de aprobación. Pedirla al líder.")
  return parsearJson("aprobacion.json", texto, AprobacionArchivoSchema)
}

function textoEvidencia(a: AprobacionArchivo): string {
  return [`De: ${a.de}`, `Para: ${a.para}`, `Fecha: ${a.fecha}`, `Asunto: ${a.asunto}`, "", a.cuerpo, ""].join("\n")
}

/** Contenido de la evidencia y su sha256. Es determinista: el mismo correo siempre da el mismo hash. */
export function construirEvidencia(directory: string, caso: string): Evidencia {
  const contenido = textoEvidencia(leerAprobacion(directory, caso))
  const sha256 = createHash("sha256").update(contenido, "utf8").digest("hex")
  return { contenido, sha256 }
}

/** Lo que se escribe en out/<caso>/aprobacion.txt: el contenido y al final su sha256. */
export function archivoEvidencia(evidencia: Evidencia): string {
  return `${evidencia.contenido}\n---\nsha256 del contenido anterior: ${evidencia.sha256}\n`
}
