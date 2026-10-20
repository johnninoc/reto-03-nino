# Imagen oficial de Bun, versión fija (la misma que se usó para desarrollar)
FROM oven/bun:1.4.3

WORKDIR /app

# Dependencias primero, para aprovechar la caché de capas
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Código, prompt, conocimiento, front y fixtures
COPY . .

# El servidor escribe en out/: se ejecuta con el usuario sin privilegios de la imagen
RUN mkdir -p out && chown -R bun:bun /app
USER bun

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
